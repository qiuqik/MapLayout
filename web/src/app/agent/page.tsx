'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import AgentDialog from '@/components/mapagent/AgentDialog';
import AgentRunTimeline from '@/components/mapagent/AgentRunTimeline';
import AgentControlPanel from '@/components/mapagent/AgentControlPanel';
import { AgentMapProvider, useAgentMap, type AgentRunEvent } from '@/lib/agentMapContext';
import { Separator } from '@/components/ui/separator';
import dynamic from 'next/dynamic';
import { getFeatureLabelId, transformSingleCoordinate } from '@/components/mapagent/utils/mapUtils';
import ForceParamsPanel, { type ForceParamsOverride, type FieldParamsOverride } from '@/components/mapagent/ForceParamsPanel';
import type { LayoutItemInput, LayoutItemPosition, LayoutItemOutput, LayoutRunMetadata } from './layout/types';

import { API_BASE_URL, saveSessionGeojson } from '@/lib/api';
import type { DatasetType, LayoutAlgorithm } from '@/components/mapagent/DatasetPanel';
import DatasetPanel from '@/components/mapagent/DatasetPanel';

const TravelMapWithNoSSR = dynamic(
  () => import('@/components/mapagent/TravelMap'),
  { ssr: false }
);

const DEFAULT_FORCE_OVERRIDE: ForceParamsOverride = {
  linkStrength: 0.4,
  collideStrength: 3.5,
  fieldStrength: 5.5,
  iterations: 2000,
  leaderThreshold: 28,
};

const DEFAULT_FIELD_OVERRIDE: FieldParamsOverride = {
  sigma: 28,
  strength: 4500,
  obstaclePadding: 6,
  cellSize: 24,
};

const countPointIcons = (styleCode: any) => {
  const generated = styleCode?._icon_generation?.generated_count;
  if (Number.isFinite(Number(generated))) return Number(generated);
  const points = Array.isArray(styleCode?.Point) ? styleCode.Point : [];
  return points.filter((point: any) => Boolean(point?.url)).length;
};

const buildSessionAgentEvents = (data: any): AgentRunEvent[] => {
  const sessionId = data?.session_id || 'history';
  const runId = data?.session_manifest?.session_id || sessionId;
  const startedAt = data?.session_manifest?.started_at || new Date().toISOString();
  const timestamp = data?.session_manifest?.finished_at || startedAt;
  const events: AgentRunEvent[] = [];
  if (data?.session_manifest?.input || data?.session_manifest) {
    events.push({
      type: 'workflow_started',
      run_id: runId,
      session_id: sessionId,
      node_id: 'input',
      label: 'Input',
      status: 'completed',
      payload: {
        input: data?.session_manifest?.input || {},
        model_config: data?.session_manifest?.model_config || {},
        prompt_versions: data?.session_manifest?.prompt_versions || {},
      },
      timestamp: startedAt,
    });
  }
  const pushCompleted = (nodeId: string, label: string, payload: Record<string, any>) => {
    events.push({
      type: 'node_completed',
      run_id: runId,
      session_id: sessionId,
      node_id: nodeId,
      label,
      status: 'completed',
      payload,
      timestamp,
    });
  };

  const manifestWorkflow = data?.session_manifest?.workflow || {};
  const outputs = data?.session_manifest?.outputs || {};
  const geojson = data?.origin_file?.data || data?.layout_file?.data || null;

  if (data?.intent || data?.session_manifest?.input) {
    pushCompleted('intent', 'Intent', {
      ...(data.intent || {}),
      user_text: data?.session_manifest?.input?.user_text,
    });
  }
  if (data?.visual_structure) {
    pushCompleted('visual', 'Visual Structure', { visual_structure: data.visual_structure });
  }
  if (geojson) {
    pushCompleted('geojson', 'GeoJSON', {
      geojson,
      feature_count: geojson?.features?.length ?? outputs.feature_count ?? 0,
    });
  }
  if (geojson || data?.validation) {
    events.push({
      type: 'node_validation',
      run_id: runId,
      session_id: sessionId,
      node_id: 'validation',
      label: 'Validation',
      status: manifestWorkflow.is_valid === false ? 'failed' : 'completed',
      payload: {
        is_valid: manifestWorkflow.is_valid !== false,
        failed_node: manifestWorkflow.failed_node || 'none',
        validation_feedback: manifestWorkflow.validation_feedback || '',
        retry_count: manifestWorkflow.retry_count || 0,
      },
      timestamp,
    });
  }
  if (data?.style_code) {
    pushCompleted('style', 'Style Code', {
      style_code: data.style_code,
      style_sections: outputs.style_sections || Object.keys(data.style_code || {}).filter((key) => !key.startsWith('_')),
    });
    pushCompleted('icon_generation', 'Icon Generation', {
      style_code: data.style_code,
      icon_generation: data.style_code?._icon_generation || { generated_count: countPointIcons(data.style_code), errors: [] },
    });
  }

  if (events.length > 0) {
    events.push({
      type: 'workflow_completed',
      run_id: runId,
      session_id: sessionId,
      label: 'Workflow completed',
      status: 'completed',
      payload: {
        session_id: sessionId,
        visual_structure: data?.visual_structure || null,
        geojson,
        style_code: data?.style_code || null,
      },
      timestamp,
    });
  }
  return events;
};

function AgentPageContent() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [currentSession, setCurrentSession] = useState<any>(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [mapDraggable, setMapDraggable] = useState(false);
  const [forceParams, setForceParams] = useState<ForceParamsOverride>({ ...DEFAULT_FORCE_OVERRIDE });
  const [fieldParams, setFieldParams] = useState<FieldParamsOverride>({ ...DEFAULT_FIELD_OVERRIDE });
  const [layoutInputs, setLayoutInputs] = useState<LayoutItemInput[]>([]);
  const [computedLayoutOutputs, setComputedLayoutOutputs] = useState<LayoutItemPosition[]>([]);
  const [layoutRunMetadata, setLayoutRunMetadata] = useState<LayoutRunMetadata | null>(null);
  const [originGeojson, setOriginGeojson] = useState<any>(null);
  const [currentDataset, setCurrentDataset] = useState<DatasetType>('layout');
  const [originPositions, setOriginPositions] = useState<LayoutItemPosition[] | null>(null);
  const [layoutPositions, setLayoutPositions] = useState<LayoutItemPosition[] | null>(null);
  const [groundtruthPositions, setGroundtruthPositions] = useState<LayoutItemPosition[] | null>(null);
  const [hasOriginFile, setHasOriginFile] = useState(false);
  const [hasLayoutFile, setHasLayoutFile] = useState(false);
  const [hasGroundtruthFile, setHasGroundtruthFile] = useState(false);
  const [rerunLayoutTrigger, setRerunLayoutTrigger] = useState(0);
  const [mapInfo, setMapInfo] = useState<{ center: { lng: number; lat: number }; bounds: { north: number; south: number; east: number; west: number } } | null>(null);
  const [layoutAlgorithm, setLayoutAlgorithm] = useState<LayoutAlgorithm>('force');
  const [layoutSeed, setLayoutSeed] = useState(1);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const loadingHistoricalGeojsonRef = useRef(false);

  const handleDatasetChange = useCallback((type: DatasetType) => {
    if (type === 'groundtruth' && !hasGroundtruthFile) {
      if (computedLayoutOutputs.length > 0) {
        setGroundtruthPositions(computedLayoutOutputs);
      }
    }
    setCurrentDataset(type);
  }, [hasGroundtruthFile, computedLayoutOutputs]);

  const handleRerunLayout = useCallback(() => {
    setRerunLayoutTrigger(prev => prev + 1);
  }, []);

  const handleLayoutOutput = useCallback((outputs: LayoutItemOutput[], inputs: LayoutItemInput[], metadata?: LayoutRunMetadata) => {
    setComputedLayoutOutputs(outputs.map(o => ({
      id: o.id,
      anchorLngLat: o.anchorLngLat,
      centerLngLat: o.centerLngLat,
    })));
    setLayoutInputs(inputs);
    setLayoutRunMetadata(metadata ?? null);
  }, []);

  const {
    setManifest,
    manifest,
    geojson: contextGeojson,
    setGeojson,
    setVisualStructure,
    visualStructure,
    activeRunId,
    setActiveRunId,
    setIsAgentRunning,
    setAgentEvents,
    setSelectedAgentEvent,
    setSelectedAgentSelection,
  } = useAgentMap();

  const processFeature = (feature: any) => {
    const type = feature.geometry.type;
    if (type !== 'Point') return null;
    if (!feature.properties?.label_title && !feature.properties?.name) return null;
    const anchor = transformSingleCoordinate(feature.geometry.coordinates);
    const center = transformSingleCoordinate(feature.properties?.label_coord || feature.geometry.coordinates);
    return [{
      id: getFeatureLabelId(feature),
      anchorLngLat: { lng: anchor[0], lat: anchor[1] },
      centerLngLat: { lng: center[0], lat: center[1] },
    }];
  }

  const loadSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/multimodal/session/${sessionId}`);
      const data = await res.json();

      setCurrentSession(data);
      setCurrentDataset('layout');
      console.log(data);

      setHasOriginFile(data.has_origin || false);
      setHasLayoutFile(data.has_layout || false);
      setHasGroundtruthFile(data.has_groundtruth || false);
      setVisualStructure(data.visual_structure || null);
      setActiveRunId(data.session_manifest?.session_id || data.session_id || sessionId);
      setIsAgentRunning(false);
      setSelectedAgentSelection(null);

      if (data.origin_file?.data?.features) {
        setOriginGeojson(data.origin_file.data);
        loadingHistoricalGeojsonRef.current = true;
        setGeojson(data.origin_file.data);
        const positions: LayoutItemPosition[] = [];
        data.origin_file.data.features.forEach((feature: any) => {
          const positionList = processFeature(feature);
          if (positionList) {
            positions.push(...positionList);
          }
        });

        console.log('[Load] originPositions:', positions);
        setOriginPositions(positions.length > 0 ? positions : null);
      } else {
        setOriginGeojson(null);
        loadingHistoricalGeojsonRef.current = true;
        setGeojson(null);
        setOriginPositions(null);
      }

      if (data.layout_file?.data?.features) {
        const positions: LayoutItemPosition[] = [];
        data.layout_file.data.features.forEach((feature: any) => {
          const positionList = processFeature(feature);
          if (positionList) {
            positions.push(...positionList);
          }
        });
        console.log('[Load] layoutPositions:', positions);
        setLayoutPositions(positions.length > 0 ? positions : null);
      }

      if (data.groundtruth_file?.data?.features) {
        const positions: LayoutItemPosition[] = []; 
        data.groundtruth_file.data.features.forEach((feature: any) => {
          const positionList = processFeature(feature);
          if (positionList) {
            positions.push(...positionList);
          }
        });
        console.log('[Load] groundtruthPositions:', positions);
        setGroundtruthPositions(positions.length > 0 ? positions : null);
      }

      setManifest(data.style_code);
      const events = buildSessionAgentEvents(data);
      setAgentEvents(events);
      const firstSelectable = events.find((event) => event.node_id);
      setSelectedAgentEvent(firstSelectable || null);
    } catch (error) {
      console.error('Error loading session:', error);
    }
  }, [
    setActiveRunId,
    setAgentEvents,
    setGeojson,
    setIsAgentRunning,
    setManifest,
    setSelectedAgentEvent,
    setSelectedAgentSelection,
    setVisualStructure,
  ]);

  const refreshSessions = useCallback(async (selectSessionId?: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/multimodal/sessions`);
      const data = await res.json();
      const sessionList = (data.sessions || []).sort((a: any, b: any) => b.session_id.localeCompare(a.session_id));
      setSessions(sessionList);
      console.log("sessionList:", sessionList);
      const targetSessionId = selectSessionId || sessionList[0]?.session_id;
      if (targetSessionId) {
        const match = sessionList.find((session: any) => session.session_id === targetSessionId || session.session_id.endsWith(`_${targetSessionId}`));
        await loadSession(match?.session_id || targetSessionId);
      }
    } catch (err) {
      console.error('Error fetching historical sessions:', err);
    }
  }, [loadSession]);

  // 初始化获取会话列表并排序
  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    if (!contextGeojson?.features) {
      loadingHistoricalGeojsonRef.current = false;
      return;
    }
    if (loadingHistoricalGeojsonRef.current) {
      loadingHistoricalGeojsonRef.current = false;
      return;
    }
    setCurrentSession(null);
    setCurrentDataset('layout');
    setOriginGeojson(contextGeojson);
    setHasOriginFile(false);
    setHasLayoutFile(false);
    setHasGroundtruthFile(false);
    const positions: LayoutItemPosition[] = [];
    contextGeojson.features.forEach((feature: any) => {
      const positionList = processFeature(feature);
      if (positionList) {
        positions.push(...positionList);
      }
    });
    setOriginPositions(positions.length > 0 ? positions : null);
    setLayoutPositions(null);
    setGroundtruthPositions(null);
  }, [contextGeojson]);

  return (
    <div className="flex flex-1 overflow-hidden bg-gray-50">
      {/* 左侧控制栏 */}
      <div className="flex flex-col flex-shrink-0 w-[21%] min-w-[300px] h-full bg-white shadow-lg z-10 border-r">
        {/* 固定头部 */}
        <div className="agent-left-header sticky top-0 z-10 shadow-sm pl-3 py-1.5">
          <h1 className="text-base font-semibold text-white">AgentMap Layout</h1>
        </div>

        {/* 可滚动内容区域 */}
        <div className="flex-1 overflow-y-auto pl-4 pr-2 pt-4 pb-4 custom-scrollbar">
          <AgentDialog onRunCompleted={refreshSessions} />

          <Separator className="my-3 bg-gray-400" />

          {/* 历史会话列表 */}
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Historical Sessions</h3>
          <div>
            {sessions.length === 0 ? (
              <div className="text-xs text-gray-400 text-center py-1">No sessions yet</div>
            ) : (
              <ul className="max-h-36 overflow-y-auto custom-scrollbar">
                {sessions.map(s => (
                  <li key={s.session_id}>
                    <button
                      className={`w-full text-[12px] text-left px-1 rounded-md transition-colors truncate ${
                        currentSession?.session_id === s.session_id
                          ? 'agent-left-session-active font-medium'
                          : 'agent-left-session-idle'
                      }`}
                      onClick={() => loadSession(s.session_id)}
                    >
                      {s.session_id}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Separator className="my-3 bg-gray-400" />

          {/* 布局控制开关 */}
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Layout Controls</h3>
          <div className="flex gap-2">
            <button
              onClick={() => setShowHeatmap(v => !v)}
              className={`flex-1 px-2 py-1.5 rounded-md border-[1.5px] text-[11px] font-semibold transition-all ${
                showHeatmap
                  ? 'agent-left-heatmap-active'
                  : 'agent-left-idle-button'
              }`}
            >
              {showHeatmap ? 'Heatmap ON' : 'Heatmap'}
            </button>
            <button
              onClick={() => setShowDebugPanel(v => !v)}
              className={`flex-1 px-2 py-1.5 rounded-md border-[1.5px] text-[11px] font-semibold transition-all ${
                showDebugPanel
                  ? 'agent-left-debug-active'
                  : 'agent-left-idle-button'
              }`}
            >
              {showDebugPanel ? 'Debug ON' : 'Debug'}
            </button>
            <button
              onClick={() => setMapDraggable(v => !v)}
              className={`flex-1 px-2 py-1.5 rounded-md border-[1.5px] text-[11px] font-semibold transition-all ${
                mapDraggable
                  ? 'agent-left-drag-active'
                  : 'agent-left-idle-button'
              }`}
            >
              {mapDraggable ? 'Anchored' : 'Draggable'}
            </button>
          </div>

          {showDebugPanel && (
            <div className="mt-3">
              <ForceParamsPanel
                forceParams={forceParams}
                fieldParams={fieldParams}
                onForceChange={updates => setForceParams(p => ({ ...p, ...updates }))}
                onFieldChange={updates => setFieldParams(p => ({ ...p, ...updates }))}
              />
            </div>
          )}

          <Separator className="my-3 bg-gray-400" />
          <DatasetPanel
            layoutOutputs={currentDataset === 'layout' ? computedLayoutOutputs : (layoutPositions || [])}
            layoutInputs={layoutInputs}
            originPositions={originPositions}
            groundtruthPositions={groundtruthPositions}
            sessionId={currentSession?.session_id || activeRunId || undefined}
            currentDataset={currentDataset}
            onDatasetChange={handleDatasetChange}
            onRerunLayout={handleRerunLayout}
            geojson={originGeojson}
            mapInfo={mapInfo}
            layoutAlgorithm={layoutAlgorithm}
            layoutSeed={layoutSeed}
            layoutRunMetadata={layoutRunMetadata}
            onLayoutAlgorithmChange={setLayoutAlgorithm}
            onLayoutSeedChange={setLayoutSeed}
          />
        </div>
      </div>

      {/* 右侧地图主视图 */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <TravelMapWithNoSSR
            geojson={originGeojson}
            styleCode={manifest}
            visualStructure={visualStructure}
            showHeatmap={showHeatmap}
            forceParams={forceParams}
            fieldParams={fieldParams}
            draggable={mapDraggable}
            currentDataset={currentDataset}
            originPositions={originPositions}
            layoutPositions={layoutPositions}
            groundtruthPositions={groundtruthPositions}
            onLayoutOutput={handleLayoutOutput}
            onGroundtruthChange={(posMap) => {
              setGroundtruthPositions(prev => {
                const currentPositions = prev || [];
                const newPositions = [...currentPositions];
                Object.entries(posMap).forEach(([id, pos]) => {
                  const existingIndex = newPositions.findIndex(p => p.id === id);
                  const existing = newPositions[existingIndex];
                  const anchorLngLat = existing?.anchorLngLat || { lng: pos.lng, lat: pos.lat };
                  if (existingIndex >= 0) {
                    newPositions[existingIndex] = {
                      ...newPositions[existingIndex],
                      centerLngLat: { lng: pos.lng, lat: pos.lat },
                    };
                  } else {
                    newPositions.push({
                      id,
                      anchorLngLat,
                      centerLngLat: { lng: pos.lng, lat: pos.lat },
                    });
                  }
                });
                return newPositions;
              });
            }}
            onMapInfoChange={setMapInfo}
            onRouteSelect={setSelectedRouteId}
            selectedRouteId={selectedRouteId}
            rerunLayoutTrigger={rerunLayoutTrigger}
            layoutAlgorithm={layoutAlgorithm}
            layoutSeed={layoutSeed}
          />
        </div>
        <div className="h-[230px] flex-none">
          <AgentRunTimeline sessionId={currentSession?.session_id || activeRunId} />
        </div>
      </div>
      <AgentControlPanel
        sessionId={currentSession?.session_id || activeRunId || undefined}
        selectedRouteId={selectedRouteId}
        onRouteSelect={setSelectedRouteId}
      />
    </div>
  );
}

export default function AgentPage() {
  return (
    <AgentMapProvider>
      <div className="flex flex-col w-screen h-screen overflow-hidden font-sans">
        <AgentPageContent />
      </div>
    </AgentMapProvider>
  );
}
