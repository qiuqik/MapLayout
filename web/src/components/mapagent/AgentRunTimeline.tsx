'use client';

import { AlertTriangleIcon, CheckCircle2Icon, CircleIcon, Loader2Icon } from 'lucide-react';
import { useAgentMap, type AgentRunEvent } from '@/lib/agentMapContext';

const NODE_ORDER = [
  { id: 'intent', label: 'Intent' },
  { id: 'visual', label: 'Visual' },
  { id: 'geojson', label: 'GeoJSON' },
  { id: 'validation', label: 'QA' },
  { id: 'style', label: 'Style' },
  { id: 'icon_generation', label: 'Icons' },
];

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
  const completed = findLastEvent(nodeEvents, (event) => event.type === 'node_completed' || event.type === 'node_validation');
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

const AgentRunTimeline = () => {
  const { agentEvents, activeRunId, isAgentRunning } = useAgentMap();
  const workflowError = findLastEvent(agentEvents, (event) => event.type === 'workflow_error');
  const workflowDone = findLastEvent(agentEvents, (event) => event.type === 'workflow_completed');

  return (
    <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-2">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold text-gray-700">Agent Run</div>
        <div className="max-w-[150px] truncate text-[10px] text-gray-500">
          {activeRunId || (agentEvents.length ? 'local run' : 'idle')}
        </div>
      </div>

      <div className="space-y-1.5">
        {NODE_ORDER.map((node) => {
          const state = nodeState(agentEvents, node.id);
          const isComplete = Boolean(state.completed);
          const Icon = state.failed ? AlertTriangleIcon : state.running ? Loader2Icon : isComplete ? CheckCircle2Icon : CircleIcon;
          return (
            <div
              key={node.id}
              className={`rounded border bg-white px-2 py-1.5 ${
                state.running ? 'border-blue-300' : state.failed ? 'border-red-300' : isComplete ? 'border-emerald-200' : 'border-gray-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon className={`h-3.5 w-3.5 flex-none ${
                  state.running ? 'animate-spin text-blue-600' : state.failed ? 'text-red-600' : isComplete ? 'text-emerald-600' : 'text-gray-300'
                }`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-gray-800">{node.label}</span>
                    <span className="text-[10px] text-gray-500">{state.latest?.status || (isComplete ? 'completed' : 'pending')}</span>
                  </div>
                  {state.summary && (
                    <div className="mt-0.5 truncate text-[10px] leading-4 text-gray-500">{state.summary}</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {(workflowDone || workflowError || isAgentRunning) && (
        <div className={`mt-2 rounded px-2 py-1 text-[10px] ${
          workflowError ? 'bg-red-50 text-red-700' : workflowDone ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'
        }`}>
          {workflowError ? summarizeEvent(workflowError) : workflowDone ? 'Ready to render' : 'Running current agent'}
        </div>
      )}
    </div>
  );
};

export default AgentRunTimeline;
