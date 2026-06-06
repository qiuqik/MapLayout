'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import AgentInteractionPanel from '@/components/mapagent/AgentInteractionPanel';
import AgentRunTimeline from '@/components/mapagent/AgentRunTimeline';
import AgentControlPanel from '@/components/mapagent/AgentControlPanel';
import AgentCodeWorkspace from '@/components/mapagent/AgentCodeWorkspace';
import { AgentMapProvider, useAgentMap, replayAgentEvents, type AgentRunEvent } from '@/lib/agentMapContext';
import dynamic from 'next/dynamic';
import { getFeatureLabelId, transformSingleCoordinate } from '@/components/mapagent/utils/mapUtils';
import ForceParamsPanel, { type ForceParamsOverride, type FieldParamsOverride } from '@/components/mapagent/ForceParamsPanel';
import type { LayoutItemInput, LayoutItemPosition, LayoutItemOutput, LayoutRunMetadata } from './layout/types';

import { API_BASE_URL, submitVlmReviewRevision } from '@/lib/api';
import type { DatasetType, LayoutAlgorithm } from '@/components/mapagent/DatasetPanel';
import DatasetPanel from '@/components/mapagent/DatasetPanel';
import { Code2Icon, GitBranchIcon, RefreshCwIcon, Share2Icon, SparklesIcon } from 'lucide-react';

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

const MAX_REVIEW_ITERATIONS = 3;

const buildSessionAgentEvents = (data: any): AgentRunEvent[] => {
  const sessionId = data?.session_id || 'history';
  const runId = data?.session_manifest?.session_id || sessionId;
  const startedAt = data?.session_manifest?.started_at || new Date().toISOString();
  const timestamp = data?.session_manifest?.finished_at || startedAt;
  const events: AgentRunEvent[] = [];
  if (data?.session_manifest?.input || data?.session_manifest) {
    const manifestInput = data?.session_manifest?.input || {};
    const prompt = manifestInput.user_text || manifestInput.message || data?.intent?.intent_enriched || '';
    const imageName = manifestInput.image_filename || manifestInput.imageFilename || '';
    events.push({
      type: 'workflow_started',
      run_id: runId,
      session_id: sessionId,
      node_id: 'input',
      label: 'Input',
      status: 'completed',
      payload: {
        input: {
          ...manifestInput,
          user_text: prompt,
          message: manifestInput.message || prompt,
          image_filename: imageName,
          imageFilename: manifestInput.imageFilename || imageName,
        },
        user_text: prompt,
        message: prompt,
        image_filename: imageName,
        imageFilename: imageName,
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
  const [topNotice, setTopNotice] = useState('');
  const loadingHistoricalGeojsonRef = useRef(false);
  const noticeTimerRef = useRef<number | null>(null);

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
    mode,
    setMode,
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
    selectedAgentEvent,
    selectedAgentSelection,
    appendAgentEvent,
    setLabelLayout,
    setConversationMessages,
    setVersionCards,
    labelLayout,
    manualEditState,
    captureMapScreenshot,
  } = useAgentMap();
  const finalReviewRunRef = useRef<string | null>(null);

  const showTopNotice = useCallback((message: string) => {
    setTopNotice(message);
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setTopNotice(''), 2400);
  }, []);

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
  }, []);

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
      const manifestInput = data?.session_manifest?.input || {};
      const prompt = manifestInput.user_text || manifestInput.message || '';
      if (prompt) {
        setConversationMessages([
          {
            id: `history-user-${sessionId}`,
            role: 'user',
            text: prompt,
            timestamp: data?.session_manifest?.started_at || new Date().toISOString(),
            scope: { type: 'global' },
          },
          {
            id: `history-agent-${sessionId}`,
            role: 'agent',
            text: 'I loaded this generated map version for review and editing.',
            timestamp: data?.session_manifest?.finished_at || new Date().toISOString(),
            scope: { type: 'global' },
          },
        ]);
      }
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
    setConversationMessages,
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
    const isSessionScopedUpdate = Boolean(currentSession?.session_id || activeRunId);
    if (!isSessionScopedUpdate) {
      setCurrentSession(null);
      setCurrentDataset('layout');
      setHasOriginFile(false);
      setHasLayoutFile(false);
      setHasGroundtruthFile(false);
      setLayoutPositions(null);
      setGroundtruthPositions(null);
    }
    setOriginGeojson(contextGeojson);
    const positions: LayoutItemPosition[] = [];
    contextGeojson.features.forEach((feature: any) => {
      const positionList = processFeature(feature);
      if (positionList) {
        positions.push(...positionList);
      }
    });
    setOriginPositions(positions.length > 0 ? positions : null);
  }, [activeRunId, contextGeojson, currentSession?.session_id]);

  useEffect(() => {
    const sessionId = currentSession?.session_id || activeRunId;
    if (!sessionId || finalReviewRunRef.current === sessionId) return;
    if (!originGeojson || !manifest || labelLayout.length === 0) return;
    const workflowDone = Boolean(currentSession || activeRunId);
    if (!workflowDone) return;
    finalReviewRunRef.current = sessionId;
    let cancelled = false;
    const runFinalReview = async () => {
      setIsAgentRunning(true);
      let nextGeojson = originGeojson;
      let nextStyleJson = manifest;
      let nextLabelLayout = labelLayout;
      const reviewHistory: any[] = [];
      try {
        for (let iteration = 1; iteration <= MAX_REVIEW_ITERATIONS; iteration += 1) {
          appendAgentEvent({
            type: 'node_started',
            run_id: sessionId,
            session_id: sessionId,
            node_id: 'vlm_review',
            label: 'VLM Review & Revision',
            status: 'running',
            payload: { mode: 'final_review', iteration, maxReviewIterations: MAX_REVIEW_ITERATIONS },
            timestamp: new Date().toISOString(),
          });
          const screenshot = captureMapScreenshot ? await captureMapScreenshot().catch((error) => {
            console.warn('Map screenshot capture failed before final VLM review.', error);
            return '';
          }) : '';
          const inputWarnings = [
            screenshot ? '' : 'Map screenshot is unavailable for final review.',
            nextLabelLayout.length > 0 ? '' : 'Label layout metadata is unavailable for final review.',
          ].filter(Boolean);
          if (inputWarnings.length > 0) {
            console.warn('Final VLM review input warnings:', inputWarnings);
          }
          const result = await submitVlmReviewRevision(sessionId, {
            mode: 'final_review',
            scope: { type: 'global' },
            geojson: nextGeojson,
            styleJson: nextStyleJson,
            mapScreenshot: screenshot,
            labelLayout: nextLabelLayout,
            manualEditState,
            originalUserIntent: currentSession?.session_manifest?.input?.user_text || '',
            reviewHistory: inputWarnings.length > 0 ? [...reviewHistory, { warnings: inputWarnings } as any] : reviewHistory,
          });
          if (cancelled) return;
          nextGeojson = result.geojson;
          nextStyleJson = result.styleJson;
          nextLabelLayout = result.labelLayout || nextLabelLayout;
          reviewHistory.push(result);
          setGeojson(nextGeojson);
          setManifest(nextStyleJson);
          setLabelLayout(nextLabelLayout);
          appendAgentEvent({
            type: 'node_completed',
            run_id: sessionId,
            session_id: sessionId,
            node_id: 'vlm_review',
            label: 'VLM Review & Revision',
            status: result.passed ? 'passed' : iteration === MAX_REVIEW_ITERATIONS ? 'needs_revision' : 'running',
            payload: { ...result, iteration, maxReviewIterations: MAX_REVIEW_ITERATIONS },
            timestamp: new Date().toISOString(),
          });
          if (result.passed || result.nextAction !== 'rerun_review') break;
        }
      } catch (error: any) {
        if (cancelled) return;
        appendAgentEvent({
          type: 'workflow_error',
          run_id: sessionId,
          session_id: sessionId,
          node_id: 'vlm_review',
          label: 'VLM Review & Revision',
          status: 'failed',
          payload: { error: error.message || 'Final review failed' },
          timestamp: new Date().toISOString(),
        });
      } finally {
        if (!cancelled) setIsAgentRunning(false);
      }
    };
    const timer = window.setTimeout(runFinalReview, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeRunId, appendAgentEvent, captureMapScreenshot, currentSession, labelLayout, manifest, manualEditState, originGeojson, setGeojson, setIsAgentRunning, setLabelLayout, setManifest]);

  const projectTitle = currentSession?.global_title || currentSession?.session_manifest?.outputs?.global_title || 'Untitled Travel Map';
  const saveStatus = activeRunId || currentSession?.session_id ? 'Saved' : 'Draft';
  const canRerunCurrentNode = Boolean(
    mode !== 'preview' &&
    selectedAgentEvent &&
    selectedAgentSelection?.kind === 'agent_event' &&
    selectedAgentEvent.type !== 'node_pending' &&
    selectedAgentEvent.node_id &&
    selectedAgentEvent.node_id !== 'input' &&
    (currentSession?.session_id || activeRunId),
  );

  const handleShare = useCallback(async () => {
    const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
    try {
      await navigator.clipboard?.writeText(shareUrl);
      showTopNotice('Workspace link copied.');
    } catch {
      showTopNotice('Could not copy the workspace link.');
    }
  }, [showTopNotice]);

  const handleGenerateNewVersion = useCallback(() => {
    setMode('edit');
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('agentmap:focus-revision-input', {
        detail: { text: 'Describe the next version you want to generate.' },
      }));
    }, 0);
    showTopNotice('Edit mode is ready for a new version request.');
  }, [setMode, showTopNotice]);

  const handleTopRerun = useCallback(async () => {
    const sessionId = currentSession?.session_id || activeRunId;
    const nodeId = selectedAgentEvent?.node_id || selectedAgentEvent?.type;
    if (!sessionId || !selectedAgentEvent || !nodeId) return;
    setIsAgentRunning(true);
    appendAgentEvent({
      type: 'node_started',
      run_id: sessionId,
      session_id: sessionId,
      node_id: nodeId,
      label: selectedAgentEvent.label || 'Regenerate from current node',
      status: 'running',
      payload: { top_bar_rerun: true },
      timestamp: new Date().toISOString(),
    });
    try {
      const response = await fetch(`${API_BASE_URL}/api/multimodal/session/${sessionId}/rerun-downstream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          node_id: nodeId,
          payload: selectedAgentEvent.payload || {},
          manual_edit_state: manualEditState,
          preserve_manual_edits: manualEditState.preserveManualEdits,
        }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || 'Regenerate failed');
      if (data.geojson) setGeojson(data.geojson);
      if (data.style_code) setManifest(data.style_code);
      if (data.visual_structure) setVisualStructure(data.visual_structure);
      await replayAgentEvents(Array.isArray(data.events) ? data.events : [], appendAgentEvent, setSelectedAgentEvent);
    } catch (error: any) {
      appendAgentEvent({
        type: 'workflow_error',
        run_id: sessionId,
        session_id: sessionId,
        node_id: nodeId,
        label: 'Regenerate from current node',
        status: 'failed',
        payload: { error: error.message || 'Regenerate failed' },
        timestamp: new Date().toISOString(),
      });
      alert(error.message || 'Regenerate failed');
    } finally {
      setIsAgentRunning(false);
    }
  }, [activeRunId, appendAgentEvent, currentSession?.session_id, manualEditState, selectedAgentEvent, setGeojson, setIsAgentRunning, setManifest, setSelectedAgentEvent, setVisualStructure]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#eef2f6] text-[#131722]">
      <header className="flex h-14 flex-none items-center justify-between border-b border-gray-200 bg-white/95 px-4 shadow-sm backdrop-blur">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#131722] text-white">
              <GitBranchIcon className="h-4 w-4" />
            </div>
            <div className="text-base font-semibold">AgentMap Layout</div>
          </div>
          <div className="h-6 w-px bg-gray-200" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{projectTitle}</div>
            <div className="text-[11px] text-emerald-600">{saveStatus}</div>
          </div>
        </div>
        <div className="flex rounded-xl border border-gray-200 bg-gray-50 p-1 text-sm font-medium text-gray-600">
          {[
            ['preview', 'Preview'],
            ['edit', 'Edit'],
            ['code', 'Code'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id as typeof mode)}
              className={`rounded-lg px-4 py-1.5 transition ${mode === id ? 'bg-white text-[#131722] shadow-sm' : 'hover:bg-white/70'}`}
            >
              {id === 'preview' && <SparklesIcon className="mr-1 inline h-3.5 w-3.5" />}
              {id === 'code' && <Code2Icon className="mr-1 inline h-3.5 w-3.5" />}
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={handleShare} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold hover:bg-gray-50">
            <Share2Icon className="mr-1 inline h-3.5 w-3.5" />
            Share
          </button>
          <button type="button" className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold hover:bg-gray-50" onClick={handleGenerateNewVersion}>
            Generate New Version
          </button>
          <button
            type="button"
            disabled={!canRerunCurrentNode}
            onClick={handleTopRerun}
            className="rounded-lg bg-[#131722] px-3 py-2 text-xs font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCwIcon className="mr-1 inline h-3.5 w-3.5" />
            Regenerate from Current Node
          </button>
        </div>
        {topNotice && (
          <div className="pointer-events-none absolute left-1/2 top-12 z-50 -translate-x-1/2 rounded-full border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 shadow-lg">
            {topNotice}
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AgentInteractionPanel
          sessions={sessions}
          currentSession={currentSession}
          onLoadSession={loadSession}
          onRunCompleted={refreshSessions}
        />

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="relative min-h-0 flex-1 overflow-hidden bg-[#e5eaf0]">
          {mode === 'code' ? (
            <AgentCodeWorkspace />
          ) : (
          <TravelMapWithNoSSR
            geojson={originGeojson}
            styleCode={manifest}
            sessionId={currentSession?.session_id || activeRunId}
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
            onLabelLayoutMetadata={setLabelLayout}
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
            mode={mode}
          />
          )}
          {mode === 'code' && (
            <details className="absolute left-4 top-4 z-50 w-[360px] rounded-xl border border-gray-200 bg-white/95 p-3 text-xs shadow-lg backdrop-blur">
              <summary className="cursor-pointer font-semibold text-[#131722]">Advanced Tools</summary>
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <button type="button" onClick={() => setShowHeatmap(v => !v)} className={`rounded-lg border px-2 py-1.5 font-semibold ${showHeatmap ? 'bg-[#131722] text-white' : 'bg-white text-gray-600'}`}>Heatmap</button>
                  <button type="button" onClick={() => setShowDebugPanel(v => !v)} className={`rounded-lg border px-2 py-1.5 font-semibold ${showDebugPanel ? 'bg-[#131722] text-white' : 'bg-white text-gray-600'}`}>Forces</button>
                  <button type="button" onClick={() => setMapDraggable(v => !v)} className={`rounded-lg border px-2 py-1.5 font-semibold ${mapDraggable ? 'bg-[#131722] text-white' : 'bg-white text-gray-600'}`}>Drag</button>
                </div>
                {showDebugPanel && (
                  <ForceParamsPanel
                    forceParams={forceParams}
                    fieldParams={fieldParams}
                    onForceChange={updates => setForceParams(p => ({ ...p, ...updates }))}
                    onFieldChange={updates => setFieldParams(p => ({ ...p, ...updates }))}
                  />
                )}
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
            </details>
          )}
        </div>
        <div className="h-[260px] flex-none">
          <AgentRunTimeline sessionId={currentSession?.session_id || activeRunId} />
        </div>
        </main>
        {mode === 'edit' && (
          <AgentControlPanel
            sessionId={currentSession?.session_id || activeRunId || undefined}
            selectedRouteId={selectedRouteId}
            onRouteSelect={setSelectedRouteId}
          />
        )}
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
