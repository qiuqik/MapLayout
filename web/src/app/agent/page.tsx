'use client';

import { useEffect, useState, useCallback } from 'react';
import AgentDialog from '@/components/mapagent/AgentDialog';
import { AgentMapProvider, useAgentMap } from '@/lib/agentMapContext';
import { Separator } from '@/components/ui/separator';
import { polygonCentroid } from 'd3-polygon';
import dynamic from 'next/dynamic';
import { transformSingleCoordinate } from '@/components/mapagent/utils/mapUtils';
import ForceParamsPanel, { type ForceParamsOverride, type FieldParamsOverride } from '@/components/mapagent/ForceParamsPanel';
import type { LayoutItemInput, LayoutItemPosition, LayoutItemOutput } from './layout/types';

import { API_BASE_URL, saveSessionGeojson } from '@/lib/api';
import type { DatasetType } from '@/components/mapagent/DatasetPanel';
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

  const handleLayoutOutput = useCallback((outputs: LayoutItemOutput[], inputs: LayoutItemInput[]) => {
    setComputedLayoutOutputs(outputs.map(o => ({
      id: o.id,
      anchorLngLat: o.anchorLngLat,
      centerLngLat: o.centerLngLat,
    })));
    setLayoutInputs(inputs);
  }, []);

  const { setManifest, manifest } = useAgentMap();

  const processFeature = (feature: any) => {
    const name = feature.properties?.name;
    const type = feature.geometry.type;
    var transforLngLat = [];
    var anchorLngLat = {};
    if (type === 'Point') {
      transforLngLat = transformSingleCoordinate(feature.geometry.coordinates);
      anchorLngLat = { lng: transforLngLat[0], lat: transforLngLat[1] };
      // console.log("transforLngLat Point",transforLngLat)
    } else if (type === 'LineString') {
      transforLngLat = transformSingleCoordinate(feature.geometry.coordinates[Math.floor(feature.geometry.coordinates.length/2)]);
      anchorLngLat = {
        lng: transforLngLat[0],
        lat: transforLngLat[1],
      }
      // console.log("transforLngLat LineString",transforLngLat)
    } else if (type === 'Polygon') {
      transforLngLat = transformSingleCoordinate(polygonCentroid(feature.geometry.coordinates[0]));
      anchorLngLat = {
        lng: transforLngLat[0],
        lat: transforLngLat[1],
      }
      // console.log("transforLngLat Polygon",transforLngLat)
    }
    const position = [];
    if (feature.properties?.card_coord) {
      const cardVisualId = feature.properties?.card_visual_id;
      const transforCardCenterLngLat = transformSingleCoordinate(feature.properties.card_coord);
      position.push({
        id: `card-${type}-${name}-${cardVisualId}`,
        anchorLngLat,
        centerLngLat: {
          lng: transforCardCenterLngLat[0],
          lat: transforCardCenterLngLat[1]
        },
      });
    }
    if (feature.properties?.label_coord) {
      const labelVisualId = feature.properties?.label_visual_id;
      const transforLabelCenterLngLat = transformSingleCoordinate(feature.properties.label_coord);
      position.push({
        id: `label-${type}-${name}-${labelVisualId}`,
        anchorLngLat,
        centerLngLat: {
          lng: transforLabelCenterLngLat[0],
          lat: transforLabelCenterLngLat[1]
        },
      });
    }
    if(position.length > 0) return position;
    return null;
  }

  const loadSession = async (sessionId: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/multimodal/session/${sessionId}`);
      const data = await res.json();

      setCurrentSession(data);
      setCurrentDataset('layout');
      console.log(data);

      setHasOriginFile(data.has_origin || false);
      setHasLayoutFile(data.has_layout || false);
      setHasGroundtruthFile(data.has_groundtruth || false);

      if (data.origin_file?.data?.features) {
        setOriginGeojson(data.origin_file.data);
        const positions: LayoutItemPosition[] = [];
        data.origin_file.data.features.forEach((feature: any) => {
          const positionList = processFeature(feature);
          if (positionList) {
            positions.push(...positionList);
          }
        });

        console.log('[Load] originPositions:', positions);
        setOriginPositions(positions.length > 0 ? positions : null);
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
    } catch (error) {
      console.error('Error loading session:', error);
    }
  };

  // 初始化获取会话列表并排序
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/multimodal/sessions`)
      .then(res => res.json())
      .then(data => {
        let sessionList = data.sessions || [];
        
        // 按照 session_id 降序排列 (保证最新的排在最前)
        sessionList = sessionList.sort((a: any, b: any) => 
          b.session_id.localeCompare(a.session_id)
        );
        setSessions(sessionList);
        console.log("sessionList:",sessionList);
        if (sessionList.length > 0) {
          loadSession(sessionList[1].session_id);
        }
      })
      .catch(err => console.error('Error fetching historical sessions:', err));
  }, []);

  return (
    <div className="flex flex-1 overflow-hidden bg-gray-50">
      {/* 左侧控制栏 */}
      <div className="flex flex-col flex-shrink-0 w-[21%] min-w-[300px] h-full bg-white shadow-lg z-10 border-r">
        {/* 固定头部 */}
        <div className="sticky top-0 z-10 bg-gray-900 shadow-sm pl-3 py-1.5">
          <h1 className="text-base font-semibold text-white">AgentMap Layout</h1>
        </div>

        {/* 可滚动内容区域 */}
        <div className="flex-1 overflow-y-auto pl-4 pr-2 pt-4 pb-4 custom-scrollbar">
          <AgentDialog />

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
                          ? 'bg-blue-50 text-black font-medium'
                          : 'text-gray-600 hover:bg-gray-100'
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
                  ? 'border-amber-500 bg-amber-50 text-amber-700'
                  : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'
              }`}
            >
              {showHeatmap ? '🟠 Heatmap ON' : '🌡 Heatmap'}
            </button>
            <button
              onClick={() => setShowDebugPanel(v => !v)}
              className={`flex-1 px-2 py-1.5 rounded-md border-[1.5px] text-[11px] font-semibold transition-all ${
                showDebugPanel
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'
              }`}
            >
              {showDebugPanel ? '🔵 Debug ON' : '⚙ Debug'}
            </button>
            <button
              onClick={() => setMapDraggable(v => !v)}
              className={`flex-1 px-2 py-1.5 rounded-md border-[1.5px] text-[11px] font-semibold transition-all ${
                mapDraggable
                  ? 'border-green-500 bg-green-50 text-green-700'
                  : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'
              }`}
            >
              {mapDraggable ? '📌 Anchored' : '⛓ Draggable'}
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
            sessionId={currentSession?.session_id}
            currentDataset={currentDataset}
            onDatasetChange={handleDatasetChange}
            onRerunLayout={handleRerunLayout}
            geojson={originGeojson}
            mapInfo={mapInfo}
          />
        </div>
      </div>

      {/* 右侧地图主视图 */}
      <div className="relative flex-1 overflow-hidden">
        <TravelMapWithNoSSR
          geojson={originGeojson}
          styleCode={manifest}
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
          rerunLayoutTrigger={rerunLayoutTrigger}
        />
      </div>
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