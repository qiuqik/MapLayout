'use client';

import { AlertTriangleIcon, CheckCircle2Icon, CircleIcon, Code2Icon, GitBranchIcon, Loader2Icon, RefreshCwIcon, SaveIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAgentMap, type AgentRunEvent } from '@/lib/agentMapContext';
import { API_BASE_URL } from '@/lib/api';

const NODE_ORDER = [
  { id: 'intent', label: 'Intent' },
  { id: 'visual', label: 'Visual' },
  { id: 'geojson', label: 'GeoJSON' },
  { id: 'validation', label: 'QA' },
  { id: 'style', label: 'Style' },
  { id: 'icon_generation', label: 'Icons' },
];

const EDGE_LABELS = ['intent', 'visual', 'geojson', 'qa', 'style'];

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
  if (event.node_id === 'style') return (payload.style_sections || []).join(', ');
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
    running: running && !completed,
    summary: summarizeEvent(completed || latest),
  };
};

const visualPalette = (event?: AgentRunEvent) => {
  const visual = event?.payload?.visual_structure || event?.payload || {};
  const palette = visual.Color?.palette;
  if (Array.isArray(palette)) return palette.map((item: any) => item?.hex).filter(Boolean).slice(0, 5);
  return [visual.Color?.background, visual.Color?.water, visual.Color?.road].filter(Boolean).slice(0, 5);
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

const jsonLines = (value: unknown) => JSON.stringify(value ?? {}, null, 2).split('\n');
const asArray = (value: unknown) => (Array.isArray(value) ? value : []);

const payloadForNode = (event: AgentRunEvent, value: unknown) => {
  if (event.node_id === 'visual') return { visual_structure: value };
  if (event.node_id === 'geojson') return { geojson: value };
  if (event.node_id === 'style' || event.node_id === 'icon_generation') return { style_code: value };
  if (event.node_id === 'intent') return typeof value === 'string' ? { intent_enriched: value } : value as Record<string, unknown>;
  return value as Record<string, unknown>;
};

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
  const canRerun = Boolean(sessionId && selectedAgentEvent && ['intent', 'visual', 'geojson', 'style', 'icon_generation', 'workflow_completed'].includes(selectedNodeId || ''));

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
              {codeError && <span className="max-w-[160px] truncate text-[10px] text-red-600">{codeError}</span>}
              {codeDirty && !codeError && <span className="text-[10px] text-amber-600">edited</span>}
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
                className="flex h-7 items-center gap-1 rounded bg-gray-900 px-2 text-[11px] text-white disabled:opacity-40"
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
            className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] ${activeTab === 'flow' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-white'}`}
          >
            <GitBranchIcon className="h-3.5 w-3.5" />
            Flow
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('code')}
            className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] ${activeTab === 'code' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-white'}`}
          >
            <Code2Icon className="h-3.5 w-3.5" />
            Code
          </button>
          </div>
        </div>
      </div>

      {activeTab === 'flow' ? (
        <div className="h-[178px] overflow-x-auto px-3 py-3">
          <div className="flex min-w-max items-center">
            {NODE_ORDER.map((node, index) => {
              const state = nodeState(agentEvents, node.id);
              const isComplete = Boolean(state.completed);
              const Icon = state.failed ? AlertTriangleIcon : state.running ? Loader2Icon : isComplete ? CheckCircle2Icon : CircleIcon;
              return (
                <div key={node.id} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => setSelectedAgentEvent(state.completed || state.latest || null)}
                    className={`h-[118px] w-[150px] rounded-md border bg-white px-3 py-2 text-left shadow-sm transition ${
                      state.running ? 'border-blue-300' : state.failed ? 'border-red-300' : isComplete ? 'border-emerald-200' : 'border-gray-200'
                    } ${selectedAgentEvent?.node_id === node.id ? 'ring-2 ring-gray-900' : ''}`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 flex-none ${
                          state.running ? 'animate-spin text-blue-600' : state.failed ? 'text-red-600' : isComplete ? 'text-emerald-600' : 'text-gray-300'
                        }`} />
                        <span className="text-xs font-semibold text-gray-900">{node.label}</span>
                      </div>
                      <span className="text-[10px] text-gray-500">{state.latest?.status || (isComplete ? 'done' : 'wait')}</span>
                    </div>
                    <div className="line-clamp-3 text-[10px] leading-4 text-gray-500">
                      {state.summary || 'Waiting for input'}
                    </div>
                    {node.id === 'visual' && visualPalette(state.completed || state.latest).length > 0 && (
                      <div className="mt-2 flex gap-1">
                        {visualPalette(state.completed || state.latest).map((color) => (
                          <span
                            key={color}
                            className="h-3 w-3 rounded-sm border border-gray-200"
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                    )}
                    {state.completed?.timestamp && (
                      <div className="mt-2 truncate text-[9px] text-gray-400">{new Date(state.completed.timestamp).toLocaleTimeString()}</div>
                    )}
                  </button>
                  {index < NODE_ORDER.length - 1 && (
                    <div className="relative flex w-12 items-center">
                      <div className="h-px flex-1 bg-gray-300" />
                      <div className="h-2 w-2 rotate-45 border-r border-t border-gray-300" />
                      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 translate-y-2 rounded bg-white px-1 text-[9px] text-gray-400">
                        {EDGE_LABELS[index]}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
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
          workflowError ? 'bg-red-50 text-red-700' : workflowDone ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'
        }`}>
          {workflowError ? summarizeEvent(workflowError) : workflowDone ? 'Ready to render' : 'Running current agent'}
        </div>
      )}
    </div>
  );
};

export default AgentRunTimeline;
