'use client';

import { Code2Icon, GitBranchIcon, RefreshCwIcon, SaveIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useAgentMap, type AgentRunEvent } from '@/lib/agentMapContext';
import { API_BASE_URL } from '@/lib/api';

const NODE_ORDER = [
  { id: 'intent', label: 'intent' },
  { id: 'visual', label: 'visual' },
  { id: 'geojson', label: 'GeoJSON' },
  { id: 'validation', label: 'QA' },
  { id: 'style', label: 'Style' },
];

const NODE_WIDTH = 116;

const FLOW_POSITIONS: Record<string, { x: number; y: number }> = {
  input: { x: 0, y: 74 },
  intent: { x: 180, y: 18 },
  visual: { x: 180, y: 116 },
  geojson: { x: 430, y: 67 },
  validation: { x: 660, y: 67 },
  style: { x: 890, y: 67 },
};

const compactText = (value: unknown, max = 86) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return text.length > max ? `${text.slice(0, max)}...` : text;
};

const findLastEvent = (events: AgentRunEvent[], predicate: (event: AgentRunEvent) => boolean) => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) return events[index];
  }
  return undefined;
};

const summarizeEvent = (event?: AgentRunEvent) => {
  const payload = event?.payload || {};
  if (!event) return '';
  if (event.node_id === 'intent') return compactText(payload.intent_enriched || payload.global_title || '');
  if (event.node_id === 'visual') {
    const visual = payload.visual_structure || {};
    const theme = visual['Theme&Design']?.theme || visual.ThemeDesign?.theme;
    const colors = visual.Color?.palette?.length;
    return [theme, colors ? `${colors} colors` : null].filter(Boolean).join(' · ');
  }
  if (event.node_id === 'geojson') return `${payload.feature_count ?? 0} features`;
  if (event.node_id === 'validation') return payload.is_valid ? 'Passed' : compactText(payload.validation_feedback || 'Needs retry');
  if (event.node_id === 'style') {
    const sections = (payload.style_sections || []).join(', ');
    const iconMeta = payload.icon_generation || payload.style_code?._icon_generation;
    const iconText = iconMeta ? `${iconMeta.generated_count ?? 0} icons${iconMeta.errors?.length ? `, ${iconMeta.errors.length} errors` : ''}` : '';
    return [sections, iconText].filter(Boolean).join(' · ');
  }
  if (event.node_id === 'icon_generation') {
    const meta = payload.icon_generation || {};
    return `${meta.generated_count ?? 0} generated${meta.errors?.length ? `, ${meta.errors.length} errors` : ''}`;
  }
  if (event.type === 'workflow_completed') return 'Workflow completed';
  if (event.type === 'workflow_error') return compactText(payload.error || 'Workflow error');
  return compactText(payload.message || event.status || '');
};

const nodeState = (events: AgentRunEvent[], nodeId: string) => {
  const nodeEvents = events.filter((event) => event.node_id === nodeId);
  const latest = nodeEvents[nodeEvents.length - 1];
  const completed = findLastEvent(nodeEvents, (event) => event.type === 'node_completed' || event.type === 'node_validation' || event.type === 'user_edit');
  const failed = latest?.status === 'failed' || latest?.type === 'workflow_error';
  const running = latest?.type === 'node_started' || latest?.status === 'running' || latest?.status === 'retrying';
  return {
    latest,
    completed,
    failed,
    running,
    summary: summarizeEvent(completed || latest),
  };
};

const eventPayload = (event: AgentRunEvent | null) => {
  const payload = event?.payload || {};
  if (!event) return {};
  if (event.node_id === 'intent') return payload.intent_enriched ? payload : payload.intent || payload;
  if (event.node_id === 'visual') return payload.visual_structure || payload;
  if (event.node_id === 'geojson') return payload.geojson || payload;
  if (event.node_id === 'style' || event.node_id === 'icon_generation') return payload.style_code || payload;
  return payload;
};

const asArray = (value: unknown) => (Array.isArray(value) ? value : []);

const payloadForNode = (event: AgentRunEvent, value: unknown) => {
  if (event.node_id === 'visual') return { visual_structure: value };
  if (event.node_id === 'geojson') return { geojson: value };
  if (event.node_id === 'style' || event.node_id === 'icon_generation') return { style_code: value };
  if (event.node_id === 'intent') return typeof value === 'string' ? { intent_enriched: value } : value as Record<string, unknown>;
  return value as Record<string, unknown>;
};

const placeholderEvent = (nodeId: string, label: string, runId?: string | null): AgentRunEvent => ({
  type: 'node_pending',
  run_id: runId || 'local',
  node_id: nodeId,
  label,
  status: 'waiting',
  payload: {},
  timestamp: new Date().toISOString(),
});

interface AgentRunTimelineProps {
  sessionId?: string | null;
}

const AgentRunTimeline = ({ sessionId }: AgentRunTimelineProps) => {
  const {
    agentEvents,
    activeRunId,
    isAgentRunning,
    selectedAgentEvent,
    setSelectedAgentEvent,
    selectedAgentSelection,
    setSelectedAgentSelection,
    setVisualStructure,
    setGeojson,
    setManifest,
    appendAgentEvent,
  } = useAgentMap();
  const [activeTab, setActiveTab] = useState<'flow' | 'code'>('flow');
  const [codeText, setCodeText] = useState('{}');
  const [codeDirty, setCodeDirty] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [rerunBusy, setRerunBusy] = useState(false);
  const localCodeEditRef = useRef(false);
  const workflowError = findLastEvent(agentEvents, (event) => event.type === 'workflow_error');
  const workflowDone = findLastEvent(agentEvents, (event) => event.type === 'workflow_completed');
  const selectedPayload = useMemo(() => eventPayload(selectedAgentEvent), [selectedAgentEvent]);
  const selectedLines = useMemo(() => codeText.split('\n'), [codeText]);

  const selectFlowNodeById = (flowNodeId: string) => {
    if (flowNodeId === 'input') {
      const event = findLastEvent(agentEvents, (item) => item.type === 'workflow_started') || {
        type: 'workflow_started',
        run_id: activeRunId || sessionId || 'local',
        node_id: 'input',
        label: 'Input',
        status: agentEvents.length ? 'completed' : 'waiting',
        payload: {},
        timestamp: new Date().toISOString(),
      };
      setSelectedAgentEvent(event);
      setSelectedAgentSelection(null);
      return;
    }
    const nodeId = flowNodeId;
    const meta = NODE_ORDER.find((item) => item.id === nodeId);
    if (!meta) return;
    const state = nodeState(agentEvents, nodeId);
    const event = state.completed || state.latest || placeholderEvent(nodeId, meta.label, activeRunId);
    setSelectedAgentEvent(event);
    setSelectedAgentSelection(null);
  };

  const flowGraph = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const statesByNode = new Map(NODE_ORDER.map((node) => [node.id, nodeState(agentEvents, node.id)]));
    const runningNodeId = NODE_ORDER.find((node) => statesByNode.get(node.id)?.running)?.id;
    const completedNodeIds = new Set(
      NODE_ORDER.filter((node) => Boolean(statesByNode.get(node.id)?.completed)).map((node) => node.id),
    );
    const hasRunInput = agentEvents.length > 0 || Boolean(activeRunId);

    nodes.push({
      id: 'input',
      type: 'input',
      position: FLOW_POSITIONS.input,
      sourcePosition: Position.Right,
      data: {
        label: (
          <button
            type="button"
            data-flow-node-id="input"
            onClick={(event) => {
              event.stopPropagation();
              selectFlowNodeById('input');
            }}
            className="w-[96px] text-left"
          >
            <div className="truncate text-xs font-semibold text-gray-900">Input</div>
            <div className="mt-1 line-clamp-2 text-[9px] leading-3 text-gray-500">{activeRunId || 'Waiting'}</div>
          </button>
        ),
      },
      style: {
        width: 112,
        minHeight: 58,
        borderRadius: 8,
        borderWidth: selectedAgentEvent?.node_id === 'input' ? 2 : 1,
        borderColor: selectedAgentEvent?.node_id === 'input' ? '#111827' : undefined,
      },
      className: hasRunInput ? 'border-[#131722] bg-[#F2F2F2]' : 'border-gray-200 bg-white',
    });

    const addFlowEdge = (
      id: string,
      source: string,
      target: string,
      options: { label?: string; active?: boolean; complete?: boolean; dashed?: boolean; type?: Edge['type']; pathOptions?: Record<string, unknown> } = {},
    ) => {
      edges.push({
        id,
        source,
        target,
        label: options.label,
        type: options.type || 'smoothstep',
        animated: Boolean(options.active),
        markerEnd: { type: MarkerType.ArrowClosed },
        style: {
          stroke: options.active ? '#131722' : options.complete ? '#4b5563' : '#9ca3af',
          strokeWidth: options.active ? 2.2 : 1.4,
          strokeDasharray: options.dashed ? '7 6' : undefined,
        },
        labelStyle: { fontSize: 9, fill: options.active ? '#131722' : '#6b7280' },
        ...(options.pathOptions ? { pathOptions: options.pathOptions } : {}),
      });
    };

    NODE_ORDER.forEach((node) => {
      const state = statesByNode.get(node.id) || nodeState(agentEvents, node.id);
      const event = state.completed || state.latest || placeholderEvent(node.id, node.label, activeRunId);
      const isComplete = Boolean(state.completed);
      const isSelectedAgent = selectedAgentSelection?.kind !== 'map_feature' && selectedAgentEvent?.node_id === node.id;
      const position = FLOW_POSITIONS[node.id];
      const statusClass = state.failed
        ? 'border-[#131722] bg-[#F2F2F2]'
        : state.running
          ? 'border-[#131722] bg-white'
          : isComplete
            ? 'border-[#131722] bg-[#F2F2F2]'
            : 'border-gray-200 bg-white';

      nodes.push({
        id: node.id,
        type: 'default',
        position,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: {
          label: (
            <button
              type="button"
              data-flow-node-id={node.id}
              onClick={(event) => {
                event.stopPropagation();
                selectFlowNodeById(node.id);
              }}
              className="w-[96px] text-left"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold text-gray-900">{node.label}</span>
                <span className="text-[9px] text-gray-500">{event.status || 'wait'}</span>
              </div>
              <div className="mt-1 line-clamp-2 text-[9px] leading-3 text-gray-500">{state.summary || 'Waiting for input'}</div>
            </button>
          ),
        },
        style: {
          width: NODE_WIDTH,
          minHeight: 62,
          borderRadius: 8,
          borderWidth: isSelectedAgent ? 2 : 1,
          borderColor: isSelectedAgent ? '#111827' : undefined,
        },
        className: statusClass,
      });
    });

    addFlowEdge('edge-input-intent', 'input', 'intent', {
      active: isAgentRunning && runningNodeId === 'intent',
      complete: completedNodeIds.has('intent'),
      dashed: true,
    });
    addFlowEdge('edge-input-visual', 'input', 'visual', {
      active: isAgentRunning && runningNodeId === 'visual',
      complete: completedNodeIds.has('visual'),
      dashed: true,
    });
    addFlowEdge('edge-intent-geojson', 'intent', 'geojson', {
      active: isAgentRunning && runningNodeId === 'geojson' && completedNodeIds.has('intent'),
      complete: completedNodeIds.has('intent') && completedNodeIds.has('geojson'),
      dashed: true,
    });
    addFlowEdge('edge-visual-geojson', 'visual', 'geojson', {
      active: isAgentRunning && runningNodeId === 'geojson' && completedNodeIds.has('visual'),
      complete: completedNodeIds.has('visual') && completedNodeIds.has('geojson'),
      dashed: true,
    });
    addFlowEdge('edge-geojson-validation', 'geojson', 'validation', {
      active: isAgentRunning && runningNodeId === 'validation' && completedNodeIds.has('geojson'),
      complete: completedNodeIds.has('geojson') && completedNodeIds.has('validation'),
      dashed: true,
    });
    addFlowEdge('edge-validation-style', 'validation', 'style', {
      active: isAgentRunning && runningNodeId === 'style' && completedNodeIds.has('validation'),
      complete: completedNodeIds.has('validation') && completedNodeIds.has('style'),
      dashed: true,
    });
    addFlowEdge('edge-validation-retry-geojson', 'validation', 'geojson', {
      label: 'retry',
      active: isAgentRunning && runningNodeId === 'geojson' && Boolean(statesByNode.get('validation')?.failed),
      complete: false,
      dashed: true,
      type: 'smoothstep',
      pathOptions: { offset: 72, borderRadius: 18 },
    });

    return { nodes, edges };
  }, [activeRunId, agentEvents, isAgentRunning, selectedAgentEvent, selectedAgentSelection]);

  useEffect(() => {
    if (localCodeEditRef.current) {
      localCodeEditRef.current = false;
      return;
    }
    setCodeText(JSON.stringify(selectedPayload ?? {}, null, 2));
    setCodeDirty(false);
    setCodeError(null);
  }, [selectedPayload]);

  const applyParsedCode = (parsed: any) => {
    if (!selectedAgentEvent) return;
    const nextEvent = {
      ...selectedAgentEvent,
      payload: payloadForNode(selectedAgentEvent, parsed),
    };
    localCodeEditRef.current = true;
    setSelectedAgentEvent(nextEvent);
    if (selectedAgentEvent.node_id === 'visual') setVisualStructure(parsed);
    if (selectedAgentEvent.node_id === 'geojson') setGeojson(parsed);
    if (selectedAgentEvent.node_id === 'style' || selectedAgentEvent.node_id === 'icon_generation') setManifest(parsed);
  };

  const handleCodeChange = (value: string) => {
    setCodeText(value);
    setCodeDirty(true);
    try {
      const parsed = JSON.parse(value);
      setCodeError(null);
      applyParsedCode(parsed);
    } catch {
      setCodeError('Invalid JSON');
      // Keep the draft in the editor; apply once it becomes valid JSON.
    }
  };

  const selectedNodeId = selectedAgentEvent?.node_id || selectedAgentEvent?.type || null;
  const canRerun = Boolean(sessionId && selectedAgentEvent && ['intent', 'visual', 'geojson', 'style', 'workflow_completed'].includes(selectedNodeId || ''));

  const recordCodeEdit = () => {
    if (!selectedAgentEvent) return;
    try {
      const parsed = JSON.parse(codeText);
      setCodeError(null);
      applyParsedCode(parsed);
      appendAgentEvent({
        type: 'user_edit',
        run_id: activeRunId || sessionId || 'local',
        session_id: sessionId || undefined,
        node_id: selectedAgentEvent.node_id,
        label: 'User edit',
        status: 'edited',
        payload: payloadForNode(selectedAgentEvent, parsed),
        timestamp: new Date().toISOString(),
      });
      setCodeDirty(false);
    } catch {
      setCodeError('Invalid JSON');
    }
  };

  const handleRerun = async () => {
    if (!sessionId || !selectedAgentEvent) return;
    let parsed: any;
    try {
      parsed = JSON.parse(codeText);
      setCodeError(null);
    } catch {
      setCodeError('Invalid JSON');
      return;
    }
    recordCodeEdit();
    setRerunBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/multimodal/session/${sessionId}/rerun-downstream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          node_id: selectedNodeId,
          payload: parsed,
        }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || 'Downstream rerun failed');
      if (data.geojson) setGeojson(data.geojson);
      if (data.style_code) setManifest(data.style_code);
      if (data.visual_structure) setVisualStructure(data.visual_structure);
      asArray(data.events).forEach((event: AgentRunEvent) => appendAgentEvent(event));
    } catch (error: any) {
      setCodeError(error.message || 'Downstream rerun failed');
    } finally {
      setRerunBusy(false);
    }
  };

  return (
    <div className="h-full border-t border-gray-200 bg-white">
      <div className="flex h-10 items-center justify-between border-b border-gray-200 px-3">
        <div className="flex items-center gap-2">
          <div className="text-xs font-semibold text-gray-800">Agent Run</div>
          <div className="max-w-[240px] truncate text-[10px] text-gray-500">
            {activeRunId || (agentEvents.length ? 'local run' : 'idle')}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'code' && (
            <div className="flex items-center gap-1">
              {codeError && <span className="max-w-[160px] truncate text-[10px] text-[#131722]">{codeError}</span>}
              {codeDirty && !codeError && <span className="text-[10px] text-gray-600">edited</span>}
              <button
                type="button"
                title="Record edit"
                onClick={recordCodeEdit}
                disabled={!selectedAgentEvent || Boolean(codeError)}
                className="flex h-7 items-center gap-1 rounded border border-gray-200 px-2 text-[11px] text-gray-700 disabled:opacity-40"
              >
                <SaveIcon className="h-3.5 w-3.5" />
                Apply
              </button>
              <button
                type="button"
                title="Rerun downstream"
                onClick={handleRerun}
                disabled={!canRerun || Boolean(codeError) || rerunBusy}
                className="flex h-7 items-center gap-1 rounded bg-[#131722] px-2 text-[11px] text-white disabled:opacity-40"
              >
                <RefreshCwIcon className={`h-3.5 w-3.5 ${rerunBusy ? 'animate-spin' : ''}`} />
                Rerun
              </button>
            </div>
          )}
          <div className="flex rounded-md border border-gray-200 bg-gray-50 p-0.5">
          <button
            type="button"
            onClick={() => setActiveTab('flow')}
            className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] ${activeTab === 'flow' ? 'bg-[#131722] text-white' : 'text-gray-600 hover:bg-white'}`}
          >
            <GitBranchIcon className="h-3.5 w-3.5" />
            Flow
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('code')}
            className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] ${activeTab === 'code' ? 'bg-[#131722] text-white' : 'text-gray-600 hover:bg-white'}`}
          >
            <Code2Icon className="h-3.5 w-3.5" />
            Code
          </button>
          </div>
        </div>
      </div>

      {activeTab === 'flow' ? (
        <div className="h-[178px] overflow-hidden">
          <ReactFlow
            nodes={flowGraph.nodes}
            edges={flowGraph.edges}
            onNodeClick={(_, node) => selectFlowNodeById(node.id)}
            fitView
            fitViewOptions={{ padding: 0.12, minZoom: 0.68, maxZoom: 1.2 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            panOnDrag
            zoomOnScroll
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={18} size={0.8} color="#e5e7eb" />
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
        </div>
      ) : (
        <div className="grid h-[178px] grid-cols-[52px_1fr] overflow-hidden bg-gray-950 font-mono text-[10px] leading-4">
          <div className="overflow-hidden border-r border-gray-800 bg-gray-900 py-2 text-right text-gray-500">
            {selectedLines.map((_, index) => (
              <div key={`line-${index}`} className="px-2">{index + 1}</div>
            ))}
          </div>
          <textarea
            value={codeText}
            onChange={(event) => handleCodeChange(event.target.value)}
            spellCheck={false}
            className="h-full w-full resize-none overflow-auto bg-gray-950 p-2 font-mono text-[10px] leading-4 text-gray-100 outline-none"
          />
        </div>
      )}

      {(workflowDone || workflowError || isAgentRunning) && (
        <div className={`border-t px-3 py-1 text-[10px] ${
          workflowError ? 'bg-[#F2F2F2] text-[#131722]' : workflowDone ? 'bg-[#F2F2F2] text-[#131722]' : 'bg-[#F2F2F2] text-[#131722]'
        }`}>
          {workflowError ? summarizeEvent(workflowError) : workflowDone ? 'Ready to render' : 'Running current agent'}
        </div>
      )}
    </div>
  );
};

export default AgentRunTimeline;
