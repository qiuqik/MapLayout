'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckIcon, ClipboardIcon, GitBranchIcon } from 'lucide-react';
import { useAgentMap, type AgentRunEvent } from '@/lib/agentMapContext';

const NODE_LABELS = [
  ['intent', 'Intent Parsing'],
  ['visual', 'Geo Retrieval'],
  ['geojson', 'Route Planning'],
  ['validation', 'Layout Planning'],
  ['style', 'Visual Style Generation'],
  ['vlm_review', 'VLM Review & Revision'],
  ['output', 'Output'],
] as const;

const payloadForEvent = (event: AgentRunEvent | null) => {
  const payload = event?.payload || {};
  if (!event) return {};
  if (event.node_id === 'intent') return payload.intent_enriched ? payload : payload.intent || payload;
  if (event.node_id === 'visual') return payload.visual_structure || payload;
  if (event.node_id === 'geojson') return payload.geojson || payload;
  if (event.node_id === 'style' || event.node_id === 'icon_generation') return payload.style_code || payload;
  if (event.node_id === 'vlm_review') return payload;
  if (event.type === 'workflow_completed') return {
    geojson: payload.geojson,
    styleJson: payload.style_code,
    visualStructure: payload.visual_structure,
  };
  return payload;
};

const latestEventForNode = (events: AgentRunEvent[], nodeId: string) => {
  if (nodeId === 'output') {
    return [...events].reverse().find((event) => event.type === 'workflow_completed') || null;
  }
  return [...events].reverse().find((event) => event.node_id === nodeId) || null;
};

const shortSummary = (event: AgentRunEvent | null) => {
  if (!event) return 'Waiting';
  const payload = event.payload || {};
  if (event.node_id === 'geojson') return `${payload.feature_count ?? payload.geojson?.features?.length ?? 0} features`;
  if (event.node_id === 'style') return Object.keys(payload.style_code || payload || {}).filter((key) => !key.startsWith('_')).join(', ') || 'Style output';
  if (event.node_id === 'vlm_review') return payload.passed === false ? 'Needs Revision' : 'Passed';
  return event.status || event.type;
};

const AgentCodeWorkspace = () => {
  const [copyNotice, setCopyNotice] = useState('');
  const copyTimerRef = useRef<number | null>(null);
  const {
    agentEvents,
    selectedAgentEvent,
    setSelectedAgentEvent,
    geojson,
    manifest,
    labelLayout,
    manualEditState,
  } = useAgentMap();

  const selectedPayload = useMemo(() => {
    if (selectedAgentEvent) return payloadForEvent(selectedAgentEvent);
    return {
      geojson,
      styleJson: manifest,
      labelLayout,
      manualEditState,
    };
  }, [geojson, labelLayout, manifest, manualEditState, selectedAgentEvent]);

  const jsonText = useMemo(() => JSON.stringify(selectedPayload || {}, null, 2), [selectedPayload]);
  const selectedLabel = selectedAgentEvent?.label || selectedAgentEvent?.node_id || 'Workspace Output';
  const validationEvent = useMemo(
    () => [...agentEvents].reverse().find((event) => event.node_id === 'validation' || event.node_id === 'vlm_review') || null,
    [agentEvents],
  );

  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
  }, []);

  const showCopyNotice = (message: string) => {
    setCopyNotice(message);
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopyNotice(''), 1800);
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard?.writeText(jsonText);
      showCopyNotice('Copied');
    } catch {
      showCopyNotice('Copy failed');
    }
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[240px_minmax(0,1fr)_280px] gap-3 bg-[#e8edf3] p-3">
      <section className="min-h-0 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex h-11 items-center gap-2 border-b border-gray-200 px-3">
          <GitBranchIcon className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-[#131722]">Node Output</h2>
        </div>
        <div className="space-y-2 overflow-y-auto p-3">
          {NODE_LABELS.map(([nodeId, label]) => {
            const event = latestEventForNode(agentEvents, nodeId);
            const selected = selectedAgentEvent?.node_id === nodeId || (nodeId === 'output' && selectedAgentEvent?.type === 'workflow_completed');
            return (
              <button
                key={nodeId}
                type="button"
                onClick={() => {
                  if (event) setSelectedAgentEvent(event);
                  else setSelectedAgentEvent({
                    type: 'node_pending',
                    run_id: 'local',
                    node_id: nodeId,
                    label,
                    status: 'waiting',
                    payload: {},
                    timestamp: new Date().toISOString(),
                  });
                }}
                className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                  selected ? 'border-[#131722] bg-[#f3f5f8]' : 'border-gray-200 bg-white hover:bg-gray-50'
                }`}
              >
                <div className="truncate text-xs font-semibold text-gray-800">{label}</div>
                <div className="mt-1 truncate text-[10px] text-gray-500">{shortSummary(event)}</div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex min-h-0 flex-col rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex h-11 items-center justify-between border-b border-gray-200 px-4">
          <div>
            <h2 className="text-sm font-semibold text-[#131722]">{selectedLabel}</h2>
            <div className="text-[10px] text-gray-500">Input / Output JSON</div>
          </div>
          <button
            type="button"
            onClick={copyJson}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            <ClipboardIcon className="h-3.5 w-3.5" />
            {copyNotice || 'Copy JSON'}
          </button>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto bg-[#111827] p-4 text-[11px] leading-5 text-gray-100">
          {jsonText}
        </pre>
      </section>

      <aside className="min-h-0 space-y-3 overflow-y-auto rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <section className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <h3 className="text-xs font-semibold text-gray-800">Validation Result</h3>
          <div className="mt-2 flex items-center gap-2 text-xs text-gray-600">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-100 text-emerald-700">
              <CheckIcon className="h-3.5 w-3.5" />
            </span>
            {validationEvent?.status || 'Waiting'}
          </div>
          <p className="mt-2 text-[11px] leading-4 text-gray-500">
            {validationEvent ? shortSummary(validationEvent) : 'Select a workflow node to inspect validation metadata.'}
          </p>
        </section>
        <section className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <h3 className="text-xs font-semibold text-gray-800">Diff</h3>
          <p className="mt-2 text-[11px] leading-4 text-gray-500">
            Version diff metadata will appear here when a revision changes structured outputs.
          </p>
        </section>
        <section className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <h3 className="text-xs font-semibold text-gray-800">Manual Edit State</h3>
          <div className="mt-2 text-[11px] leading-5 text-gray-600">
            <div>Preserve: {manualEditState.preserveManualEdits ? 'Enabled' : 'Disabled'}</div>
            <div>Locked Elements: {manualEditState.lockedElements.length}</div>
            <div>Edited Properties: {Object.keys(manualEditState.editedProperties).length}</div>
          </div>
        </section>
      </aside>
    </div>
  );
};

export default AgentCodeWorkspace;
