'use client';

import { useEffect, useMemo, useState } from 'react';
import { RefreshCwIcon, SaveIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { API_BASE_URL } from '@/lib/api';
import { useAgentMap, type AgentRunEvent } from '@/lib/agentMapContext';

interface AgentControlPanelProps {
  sessionId?: string;
  selectedRouteId?: string | null;
  onRouteSelect?: (routeId: string | null) => void;
}

const editablePayload = (event: AgentRunEvent | null) => {
  if (!event) return {};
  const payload = event.payload || {};
  if (event.node_id === 'intent') return payload.intent_enriched ? payload : payload.intent || payload;
  if (event.node_id === 'visual') return payload.visual_structure || payload;
  if (event.node_id === 'geojson') return payload.geojson || payload;
  if (event.node_id === 'style' || event.node_id === 'icon_generation') return payload.style_code || payload;
  if (event.type === 'workflow_completed') return payload;
  return payload;
};

const AgentControlPanel: React.FC<AgentControlPanelProps> = ({ sessionId, selectedRouteId, onRouteSelect }) => {
  const {
    manifest,
    setManifest,
    setGeojson,
    visualStructure,
    setVisualStructure,
    selectedAgentEvent,
    appendAgentEvent,
  } = useAgentMap();
  const [editorText, setEditorText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEditorText(JSON.stringify(editablePayload(selectedAgentEvent), null, 2));
  }, [selectedAgentEvent]);

  const routes = manifest?.Route || [];
  const canRerun = Boolean(
    selectedAgentEvent &&
    ['intent', 'visual', 'geojson', 'style', 'icon_generation', 'workflow_completed'].includes(
      selectedAgentEvent.node_id || selectedAgentEvent.type,
    )
  );
  const activeRoute = useMemo(
    () => routes.find((route: any) => route.visual_id === selectedRouteId) || routes[0],
    [routes, selectedRouteId],
  );

  const applyPayloadLocally = (payload: any) => {
    const nodeId = selectedAgentEvent?.node_id;
    if (nodeId === 'intent') {
      appendAgentEvent({
        type: 'node_completed',
        run_id: sessionId || 'local',
        session_id: sessionId,
        node_id: 'intent',
        label: 'Intent edit applied',
        status: 'completed',
        payload: typeof payload === 'string' ? { intent_enriched: payload } : payload,
        timestamp: new Date().toISOString(),
      });
    } else if (nodeId === 'visual') {
      setVisualStructure(payload.visual_structure || payload);
    } else if (nodeId === 'geojson') {
      setGeojson(payload.geojson || payload);
    } else if (nodeId === 'style' || nodeId === 'icon_generation') {
      setManifest(payload.style_code || payload);
    } else if (selectedAgentEvent?.type === 'workflow_completed') {
      setGeojson(payload.geojson || null);
      setManifest(payload.style_code || null);
      setVisualStructure(payload.visual_structure || null);
    }
  };

  const handleApply = () => {
    try {
      const parsed = JSON.parse(editorText);
      applyPayloadLocally(parsed);
    } catch (error: any) {
      alert(error.message || 'Invalid JSON');
    }
  };

  const handleRerun = async () => {
    if (!sessionId || !selectedAgentEvent) return;
    let parsed: any;
    try {
      parsed = JSON.parse(editorText);
    } catch (error: any) {
      alert(error.message || 'Invalid JSON');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/multimodal/session/${sessionId}/rerun-downstream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          node_id: selectedAgentEvent.node_id || selectedAgentEvent.type,
          payload: parsed,
        }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || 'Downstream rerun failed');
      if (data.geojson) setGeojson(data.geojson);
      if (data.style_code) setManifest(data.style_code);
      if (data.visual_structure) setVisualStructure(data.visual_structure);

      const events = Array.isArray(data.events) ? data.events : [];
      if (events.length > 0) {
        events.forEach((event: AgentRunEvent) => appendAgentEvent(event));
      } else {
        appendAgentEvent({
          type: 'node_completed',
          run_id: sessionId,
          session_id: sessionId,
          node_id: 'style',
          label: 'Downstream rerun',
          status: 'completed',
          payload: { style_code: data.style_code, geojson: data.geojson },
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error: any) {
      alert(error.message || 'Downstream rerun failed');
    } finally {
      setBusy(false);
    }
  };

  const updateRoute = (patch: Record<string, any>) => {
    if (!manifest) return;
    const routeId = activeRoute?.visual_id;
    const nextRoutes = routes.map((route: any) => (
      route.visual_id === routeId ? { ...route, ...patch } : route
    ));
    setManifest({ ...manifest, Route: nextRoutes });
    if (routeId) onRouteSelect?.(routeId);
  };

  return (
    <aside className="flex h-full w-[280px] flex-shrink-0 flex-col border-l bg-white">
      <div className="border-b px-3 py-2">
        <div className="text-sm font-semibold text-gray-800">Controls</div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
        <section>
          <div className="mb-2 text-xs font-semibold text-gray-700">Route</div>
          {routes.length === 0 ? (
            <div className="rounded border border-gray-200 bg-gray-50 px-2 py-2 text-xs text-gray-500">No routes</div>
          ) : (
            <div className="space-y-2">
              <select
                value={activeRoute?.visual_id || ''}
                onChange={(event) => onRouteSelect?.(event.target.value)}
                className="w-full rounded border px-2 py-1 text-xs"
              >
                {routes.map((route: any) => (
                  <option key={route.visual_id} value={route.visual_id}>{route.visual_id}</option>
                ))}
              </select>
              <div className="grid grid-cols-3 gap-1">
                {(['straight', 'bezier', 'navigation'] as const).map((style) => (
                  <button
                    key={style}
                    type="button"
                    onClick={() => updateRoute({ style })}
                    className={`rounded border px-2 py-1 text-[11px] ${activeRoute?.style === style ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-gray-50 text-gray-700'}`}
                  >
                    {style}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-1">
                {(['solid', 'dashed'] as const).map((linePattern) => (
                  <button
                    key={linePattern}
                    type="button"
                    onClick={() => updateRoute({ linePattern })}
                    className={`rounded border px-2 py-1 text-[11px] ${activeRoute?.linePattern === linePattern ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-gray-50 text-gray-700'}`}
                  >
                    {linePattern}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={12}
                  value={Number(activeRoute?.width || 4)}
                  onChange={(event) => updateRoute({ width: Number(event.target.value) })}
                />
                <span className="text-[11px] text-gray-500">{Number(activeRoute?.width || 4)}</span>
              </div>
              <input
                type="color"
                value={activeRoute?.Color || activeRoute?.color || '#E4572E'}
                onChange={(event) => updateRoute({ color: event.target.value, Color: event.target.value })}
                className="h-8 w-full rounded border"
              />
            </div>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold text-gray-700">Agent Output</div>
            <div className="max-w-[130px] truncate text-[10px] text-gray-500">
              {selectedAgentEvent?.label || selectedAgentEvent?.node_id || 'none'}
            </div>
          </div>
          <textarea
            value={editorText}
            onChange={(event) => setEditorText(event.target.value)}
            className="h-56 w-full rounded border bg-gray-950 p-2 font-mono text-[10px] leading-4 text-gray-100"
            spellCheck={false}
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button size="sm" variant="outline" onClick={handleApply} disabled={!selectedAgentEvent}>
              <SaveIcon className="mr-1 h-3.5 w-3.5" />
              Apply
            </Button>
            <Button size="sm" onClick={handleRerun} disabled={!sessionId || !canRerun || busy}>
              <RefreshCwIcon className={`mr-1 h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
              Rerun
            </Button>
          </div>
        </section>
      </div>
    </aside>
  );
};

export default AgentControlPanel;
