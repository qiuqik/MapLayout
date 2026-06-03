'use client';

import { useEffect, useMemo, useState } from 'react';
import { RefreshCwIcon, SaveIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { API_BASE_URL } from '@/lib/api';
import { useAgentMap, type AgentRunEvent, type AgentSelection } from '@/lib/agentMapContext';

interface AgentControlPanelProps {
  sessionId?: string;
  selectedRouteId?: string | null;
  onRouteSelect?: (routeId: string | null) => void;
}

const editablePayload = (event: AgentRunEvent | null, selection?: AgentSelection | null) => {
  if (selection?.kind === 'map_feature') return selection.payload || {};
  if (selection?.kind === 'agent_output') return eventPayloadFromEvent(selection.event || event);
  return eventPayloadFromEvent(event);
};

const eventPayloadFromEvent = (event: AgentRunEvent | null) => {
  if (!event) return {};
  const payload = event.payload || {};
  if (event.node_id === 'intent') return payload.intent_enriched ? payload : payload.intent || payload;
  if (event.node_id === 'visual') return payload.visual_structure || payload;
  if (event.node_id === 'geojson') return payload.geojson || payload;
  if (event.node_id === 'style' || event.node_id === 'icon_generation') return payload.style_code || payload;
  if (event.type === 'workflow_completed') return payload;
  return payload;
};

const payloadForNode = (event: AgentRunEvent | null, value: any) => {
  if (!event) return value;
  if (event.node_id === 'visual') return { visual_structure: value };
  if (event.node_id === 'geojson') return { geojson: value };
  if (event.node_id === 'style' || event.node_id === 'icon_generation') return { style_code: value };
  if (event.node_id === 'intent') return typeof value === 'string' ? { intent_enriched: value } : value;
  return value;
};

const clone = (value: any) => JSON.parse(JSON.stringify(value ?? {}));
const asArray = (value: any) => (Array.isArray(value) ? value : []);
const isHex = (value: unknown) => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);

const textValue = (value: any) => (value === undefined || value === null ? '' : String(value));

const numberValue = (value: any, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const setNestedValue = (target: any, path: (string | number)[], value: any) => {
  let cursor = target;
  path.forEach((key, index) => {
    if (index === path.length - 1) {
      cursor[key] = value;
      return;
    }
    if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = typeof path[index + 1] === 'number' ? [] : {};
    cursor = cursor[key];
  });
};

const getNodeTitle = (event: AgentRunEvent | null) => event?.node_id || event?.type || 'none';

const AgentControlPanel: React.FC<AgentControlPanelProps> = ({ sessionId, selectedRouteId, onRouteSelect }) => {
  const {
    manifest,
    setManifest,
    geojson,
    setGeojson,
    setVisualStructure,
    selectedAgentEvent,
    setSelectedAgentEvent,
    selectedAgentSelection,
    setSelectedAgentSelection,
    appendAgentEvent,
  } = useAgentMap();
  const [editorText, setEditorText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEditorText(JSON.stringify(editablePayload(selectedAgentEvent, selectedAgentSelection), null, 2));
  }, [selectedAgentEvent, selectedAgentSelection]);

  const parsedEditor = useMemo(() => {
    try {
      return JSON.parse(editorText || '{}');
    } catch {
      return null;
    }
  }, [editorText]);

  const routes = manifest?.Route || [];
  const selectedNodeId = selectedAgentSelection?.node_id || selectedAgentEvent?.node_id || selectedAgentEvent?.type || null;
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
    if (selectedAgentSelection?.kind === 'map_feature') {
      updateMapFeaturePayload(payload);
      return;
    }
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

  const updateEditorJson = (updater: (draft: any) => void, applyVisual = false) => {
    if (!parsedEditor) return;
    const next = clone(parsedEditor);
    updater(next);
    setEditorText(JSON.stringify(next, null, 2));
    if (selectedAgentSelection?.kind === 'map_feature') {
      updateMapFeaturePayload(next);
      return;
    }
    if (selectedAgentEvent) {
      const nextEvent = {
        ...selectedAgentEvent,
        payload: payloadForNode(selectedAgentEvent, next),
      };
      setSelectedAgentEvent(nextEvent);
      if (selectedAgentSelection?.kind === 'agent_output') {
        setSelectedAgentSelection({
          ...selectedAgentSelection,
          event: nextEvent,
          payload: nextEvent.payload,
        });
      }
    }
    if (applyVisual && selectedAgentEvent?.node_id === 'visual') {
      setVisualStructure(next.visual_structure || next);
    } else if (selectedAgentEvent?.node_id === 'geojson') {
      setGeojson(next.geojson || next);
    } else if (selectedAgentEvent?.node_id === 'style' || selectedAgentEvent?.node_id === 'icon_generation') {
      setManifest(next.style_code || next);
    }
  };

  const updateMapFeaturePayload = (payload: any) => {
    if (selectedAgentSelection?.kind !== 'map_feature') return;
    const feature = payload.feature || payload;
    const props = feature.properties || {};
    const featureId = props.feature_id || selectedAgentSelection.payload?.feature?.properties?.feature_id;
    const visualId = props.visual_id || selectedAgentSelection.payload?.feature?.properties?.visual_id;
    const name = props.name || selectedAgentSelection.payload?.feature?.properties?.name;
    if (geojson?.features && feature?.type === 'Feature') {
      const nextGeojson = {
        ...geojson,
        features: geojson.features.map((item: any) => {
          const itemProps = item.properties || {};
          const same = (featureId && itemProps.feature_id === featureId) ||
            (visualId && itemProps.visual_id === visualId && itemProps.name === name);
          return same ? feature : item;
        }),
      };
      setGeojson(nextGeojson);
    }
    setSelectedAgentSelection({
      ...selectedAgentSelection,
      label: props.name || props.label_title || selectedAgentSelection.label,
      payload: { ...selectedAgentSelection.payload, ...payload, feature },
    });
  };

  const updateGeojsonFeature = (featureIndex: number, path: (string | number)[], value: any) => {
    updateEditorJson((draft) => {
      const feature = draft.features?.[featureIndex];
      if (!feature) return;
      setNestedValue(feature, path, value);
    });
  };

  const updateStyleSection = (section: 'Point' | 'Route' | 'Label' | 'Global', index: number, path: (string | number)[], value: any) => {
    updateEditorJson((draft) => {
      if (!Array.isArray(draft[section])) draft[section] = [];
      if (!draft[section][index]) draft[section][index] = {};
      setNestedValue(draft[section][index], path, value);
    });
  };

  const updateVisualPath = (path: (string | number)[], value: any) => {
    updateEditorJson((draft) => setNestedValue(draft, path, value), true);
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

  const renderField = (
    label: string,
    value: any,
    onChange: (value: string) => void,
    options?: { multiline?: boolean; placeholder?: string },
  ) => (
    <label className="block space-y-1 text-[10px] text-gray-600">
      <span className="font-medium text-gray-700">{label}</span>
      {options?.multiline ? (
        <textarea
          value={textValue(value)}
          placeholder={options.placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-[52px] w-full resize-y rounded border border-gray-200 px-2 py-1 text-[11px] leading-4"
        />
      ) : (
        <input
          value={textValue(value)}
          placeholder={options?.placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="h-7 w-full rounded border border-gray-200 px-2 text-[11px]"
        />
      )}
    </label>
  );

  const renderColorField = (label: string, value: any, onChange: (value: string) => void) => (
    <label className="grid grid-cols-[76px_1fr_34px] items-center gap-2 text-[10px] text-gray-600">
      <span className="font-medium text-gray-700">{label}</span>
      <input
        value={textValue(value)}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 rounded border border-gray-200 px-2 font-mono text-[10px]"
      />
      <input
        type="color"
        value={isHex(value) ? value : '#000000'}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 w-8 rounded border"
      />
    </label>
  );

  const renderNodeInfo = () => {
    if (!selectedAgentEvent && !selectedAgentSelection) return null;
    return (
      <div className="mb-3 space-y-1 rounded border border-gray-200 bg-gray-50 p-2 text-[10px] text-gray-600">
        <div className="text-[11px] font-semibold text-gray-700">Node Info</div>
        <div className="grid grid-cols-[52px_1fr] gap-1">
          <span>ID</span>
          <span className="truncate font-mono">{selectedAgentSelection?.node_id || selectedAgentEvent?.node_id || selectedAgentEvent?.type}</span>
          <span>Name</span>
          <span className="truncate">{selectedAgentSelection?.label || selectedAgentEvent?.label || getNodeTitle(selectedAgentEvent)}</span>
          <span>Status</span>
          <span className="truncate">{selectedAgentSelection?.kind || selectedAgentEvent?.status || selectedAgentEvent?.type}</span>
        </div>
      </div>
    );
  };

  const renderMapFeatureProperties = () => {
    if (selectedAgentSelection?.kind !== 'map_feature' || !parsedEditor) return null;
    const feature = parsedEditor.feature || parsedEditor;
    const props = feature.properties || {};
    const geometryType = feature.geometry?.type || selectedAgentSelection.payload?.geometryType;
    return (
      <div className="mb-3 space-y-3 rounded border border-gray-200 bg-gray-50 p-2">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold text-gray-700">Map Feature</div>
          <div className="text-[10px] text-gray-500">{geometryType || selectedAgentSelection.node_id}</div>
        </div>
        {renderField('Name', props.name || props.label_title || props.visual_id, (value) => updateEditorJson((draft) => {
          const target = draft.feature || draft;
          if (!target.properties) target.properties = {};
          target.properties.name = value;
          target.properties.label_title = target.properties.label_title ?? value;
        }))}
        {renderField('Description', props.description || props.label_script, (value) => updateEditorJson((draft) => {
          const target = draft.feature || draft;
          if (!target.properties) target.properties = {};
          target.properties.description = value;
          target.properties.label_script = target.properties.label_script ?? value;
        }), { multiline: true })}
        {renderField('Icon', props.icon || props.icon_name, (value) => updateEditorJson((draft) => {
          const target = draft.feature || draft;
          if (!target.properties) target.properties = {};
          target.properties.icon = value;
        }))}
        {renderField('Label title', props.label_title, (value) => updateEditorJson((draft) => {
          const target = draft.feature || draft;
          if (!target.properties) target.properties = {};
          target.properties.label_title = value;
        }))}
        {renderField('Label script', props.label_script, (value) => updateEditorJson((draft) => {
          const target = draft.feature || draft;
          if (!target.properties) target.properties = {};
          target.properties.label_script = value;
        }), { multiline: true })}
        <label className="block space-y-1 text-[10px] text-gray-600">
          <span className="font-medium text-gray-700">Level</span>
          <select
            value={props.label_level || props.hierarchy || 'secondary'}
            onChange={(event) => updateEditorJson((draft) => {
              const target = draft.feature || draft;
              if (!target.properties) target.properties = {};
              target.properties.label_level = event.target.value;
            })}
            className="h-7 w-full rounded border border-gray-200 px-2 text-[11px]"
          >
            <option value="core">core</option>
            <option value="secondary">secondary</option>
            <option value="detail">detail</option>
          </select>
        </label>
      </div>
    );
  };

  const renderIntentProperties = () => {
    if (selectedNodeId !== 'intent' || !parsedEditor) return null;
    return (
      <div className="mb-3 space-y-3 rounded border border-gray-200 bg-gray-50 p-2">
        <div className="text-[11px] font-semibold text-gray-700">Intent</div>
        {renderField('Global title', parsedEditor.global_title, (value) => updateEditorJson((draft) => { draft.global_title = value; }))}
        {renderField('Global description', parsedEditor.global_description, (value) => updateEditorJson((draft) => { draft.global_description = value; }), { multiline: true })}
        {renderField('Intent', parsedEditor.intent_enriched || parsedEditor.intent || parsedEditor.user_text, (value) => updateEditorJson((draft) => { draft.intent_enriched = value; }), { multiline: true })}
      </div>
    );
  };

  const renderValidationProperties = () => {
    if (selectedNodeId !== 'validation' || !parsedEditor) return null;
    return (
      <div className="mb-3 space-y-3 rounded border border-gray-200 bg-gray-50 p-2">
        <div className="text-[11px] font-semibold text-gray-700">QA</div>
        <label className="block space-y-1 text-[10px] text-gray-600">
          <span className="font-medium text-gray-700">Valid</span>
          <select
            value={String(Boolean(parsedEditor.is_valid))}
            onChange={(event) => updateEditorJson((draft) => { draft.is_valid = event.target.value === 'true'; })}
            className="h-7 w-full rounded border border-gray-200 px-2 text-[11px]"
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </label>
        {renderField('Failed node', parsedEditor.failed_node, (value) => updateEditorJson((draft) => { draft.failed_node = value; }))}
        {renderField('Feedback', parsedEditor.validation_feedback, (value) => updateEditorJson((draft) => { draft.validation_feedback = value; }), { multiline: true })}
      </div>
    );
  };

  const renderVisualProperties = () => {
    if (selectedNodeId !== 'visual' || !parsedEditor) return null;
    const palette = asArray(parsedEditor.Color?.palette);
    return (
      <div className="mb-3 space-y-3 rounded border border-gray-200 bg-gray-50 p-2">
        <div className="text-[11px] font-semibold text-gray-700">Visual</div>
        {renderField('Theme', parsedEditor['Theme&Design']?.theme || parsedEditor.ThemeDesign?.theme, (value) => {
          if (parsedEditor['Theme&Design']) updateVisualPath(['Theme&Design', 'theme'], value);
          else updateVisualPath(['ThemeDesign', 'theme'], value);
        })}
        <div className="space-y-2">
          {['background', 'water', 'road'].map((key) => (
            <div key={key}>
              {renderColorField(key, parsedEditor.Color?.[key], (value) => updateVisualPath(['Color', key], value))}
            </div>
          ))}
        </div>
        {palette.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] font-semibold text-gray-500">Palette</div>
            {palette.slice(0, 10).map((item: any, index: number) => (
              <label key={`${item.name || 'color'}-${index}`} className="grid grid-cols-[1fr_34px] items-center gap-2 text-[10px] text-gray-600">
                <input
                  value={textValue(item.name || `color ${index + 1}`)}
                  onChange={(event) => updateVisualPath(['Color', 'palette', index, 'name'], event.target.value)}
                  className="h-7 min-w-0 rounded border border-gray-200 px-2 text-[10px]"
                />
                <input
                  type="color"
                  value={isHex(item.hex) ? item.hex : '#000000'}
                  onChange={(event) => updateVisualPath(['Color', 'palette', index, 'hex'], event.target.value)}
                  className="h-7 w-8 rounded border"
                />
              </label>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderGeojsonProperties = () => {
    if (selectedNodeId !== 'geojson' || !parsedEditor) return null;
    const features = asArray(parsedEditor.features);
    const points = features
      .map((feature: any, index: number) => ({ feature, index }))
      .filter(({ feature }) => feature?.geometry?.type === 'Point');
    const globals = asArray(parsedEditor.global_properties);
    const days = Array.from(new Set(points.map(({ feature }) => feature.properties?.day).filter(Boolean)));
    const orderedDayKeys = days.length ? days : ['POI'];

    return (
      <div className="mb-3 space-y-3 rounded border border-gray-200 bg-gray-50 p-2">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold text-gray-700">GeoJSON</div>
          <div className="text-[10px] text-gray-500">{points.length} POI</div>
        </div>
        {globals.length > 0 && (
          <details open className="rounded border border-gray-200 bg-white p-2">
            <summary className="cursor-pointer text-[10px] font-semibold text-gray-700">Global</summary>
            <div className="mt-2 space-y-2">
              {globals.slice(0, 2).map((item: any, index: number) => (
                <div key={`global-${index}`} className="space-y-2 border-t border-gray-100 pt-2 first:border-t-0 first:pt-0">
                  {renderField('Title', item.title, (value) => updateEditorJson((draft) => { draft.global_properties[index].title = value; }))}
                  {renderField('Script', item.script, (value) => updateEditorJson((draft) => { draft.global_properties[index].script = value; }), { multiline: true })}
                  {renderField('Extra', item.extra_info, (value) => updateEditorJson((draft) => { draft.global_properties[index].extra_info = value; }), { multiline: true })}
                </div>
              ))}
            </div>
          </details>
        )}
        {orderedDayKeys.map((dayKey) => {
          const dayPoints = days.length ? points.filter(({ feature }) => feature.properties?.day === dayKey) : points;
          return (
            <details key={String(dayKey)} open={orderedDayKeys.length <= 2} className="rounded border border-gray-200 bg-white p-2">
              <summary className="cursor-pointer text-[10px] font-semibold text-gray-700">{String(dayKey)}</summary>
              <div className="mt-2 space-y-2">
                {dayPoints.map(({ feature, index }) => {
                  const props = feature.properties || {};
                  return (
                    <details key={props.visual_id || props.id || index} className="rounded border border-gray-100 bg-gray-50 p-2">
                      <summary className="cursor-pointer truncate text-[10px] font-semibold text-gray-700">
                        {props.name || props.label_title || `POI ${index + 1}`}
                      </summary>
                      <div className="mt-2 space-y-2">
                        {renderField('Name', props.name, (value) => updateGeojsonFeature(index, ['properties', 'name'], value))}
                        {renderField('Description', props.description, (value) => updateGeojsonFeature(index, ['properties', 'description'], value), { multiline: true })}
                        {renderField('Icon', props.icon || props.icon_name, (value) => updateGeojsonFeature(index, ['properties', 'icon'], value))}
                        {renderField('Label title', props.label_title, (value) => updateGeojsonFeature(index, ['properties', 'label_title'], value))}
                        {renderField('Label script', props.label_script, (value) => updateGeojsonFeature(index, ['properties', 'label_script'], value), { multiline: true })}
                        {renderField('Label extra', props.label_extra_info, (value) => updateGeojsonFeature(index, ['properties', 'label_extra_info'], value), { multiline: true })}
                        <label className="block space-y-1 text-[10px] text-gray-600">
                          <span className="font-medium text-gray-700">Level</span>
                          <select
                            value={props.label_level || props.hierarchy || 'secondary'}
                            onChange={(event) => updateGeojsonFeature(index, ['properties', 'label_level'], event.target.value)}
                            className="h-7 w-full rounded border border-gray-200 px-2 text-[11px]"
                          >
                            <option value="core">core</option>
                            <option value="secondary">secondary</option>
                            <option value="detail">detail</option>
                          </select>
                        </label>
                      </div>
                    </details>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    );
  };

  const renderStyleProperties = () => {
    if (!['style', 'icon_generation'].includes(selectedNodeId || '') || !parsedEditor) return null;
    const points = asArray(parsedEditor.Point);
    const labels = asArray(parsedEditor.Label);
    const globals = asArray(parsedEditor.Global);
    const routesForStyle = asArray(parsedEditor.Route);
    const iconMeta = parsedEditor._icon_generation;

    return (
      <div className="mb-3 space-y-3 rounded border border-gray-200 bg-gray-50 p-2">
        <div className="text-[11px] font-semibold text-gray-700">{selectedNodeId === 'icon_generation' ? 'Icons' : 'Style'}</div>
        {globals.length > 0 && (
          <details open className="rounded border border-gray-200 bg-white p-2">
            <summary className="cursor-pointer text-[10px] font-semibold text-gray-700">Global</summary>
            <div className="mt-2 space-y-3">
              {globals.map((item: any, index: number) => (
                <div key={`style-global-${index}`} className="space-y-2 border-t border-gray-100 pt-2 first:border-t-0 first:pt-0">
                  {renderField('Title', item.content?.title, (value) => updateStyleSection('Global', index, ['content', 'title'], value))}
                  {renderField('Script', item.content?.script, (value) => updateStyleSection('Global', index, ['content', 'script'], value), { multiline: true })}
                  {renderField('Extra', item.content?.extra_info, (value) => updateStyleSection('Global', index, ['content', 'extra_info'], value), { multiline: true })}
                  {renderColorField('Text', item.style?.title?.color || item.style?.container?.color, (value) => updateStyleSection('Global', index, ['style', 'title', 'color'], value))}
                  {renderColorField('Panel', item.style?.container?.backgroundColor || item.style?.container?.background, (value) => updateStyleSection('Global', index, ['style', 'container', 'backgroundColor'], value))}
                </div>
              ))}
            </div>
          </details>
        )}
        {labels.length > 0 && (
          <details open className="rounded border border-gray-200 bg-white p-2">
            <summary className="cursor-pointer text-[10px] font-semibold text-gray-700">Label</summary>
            <div className="mt-2 space-y-3">
              {labels.map((item: any, index: number) => (
                <div key={item.visual_id || `label-${index}`} className="space-y-2 border-t border-gray-100 pt-2 first:border-t-0 first:pt-0">
                  <div className="truncate text-[10px] font-semibold text-gray-500">{item.visual_id || `label ${index + 1}`}</div>
                  <div className="grid grid-cols-2 gap-2">
                    {renderField('Width', item.width, (value) => updateStyleSection('Label', index, ['width'], numberValue(value, item.width)))}
                    {renderField('Height', item.height, (value) => updateStyleSection('Label', index, ['height'], numberValue(value, item.height)))}
                  </div>
                  <label className="block space-y-1 text-[10px] text-gray-600">
                    <span className="font-medium text-gray-700">Level</span>
                    <select
                      value={item.hierarchy || item.level || 'secondary'}
                      onChange={(event) => updateStyleSection('Label', index, ['hierarchy'], event.target.value)}
                      className="h-7 w-full rounded border border-gray-200 px-2 text-[11px]"
                    >
                      <option value="core">core</option>
                      <option value="secondary">secondary</option>
                      <option value="detail">detail</option>
                    </select>
                  </label>
                  {renderColorField('Title', item.style?.title?.color, (value) => updateStyleSection('Label', index, ['style', 'title', 'color'], value))}
                  {renderColorField('Script', item.style?.script?.color, (value) => updateStyleSection('Label', index, ['style', 'script', 'color'], value))}
                  {renderColorField('Extra', item.style?.extra_info?.color, (value) => updateStyleSection('Label', index, ['style', 'extra_info', 'color'], value))}
                </div>
              ))}
            </div>
          </details>
        )}
        {points.length > 0 && (
          <details open={selectedNodeId === 'icon_generation'} className="rounded border border-gray-200 bg-white p-2">
            <summary className="cursor-pointer text-[10px] font-semibold text-gray-700">Point</summary>
            <div className="mt-2 space-y-3">
              {points.map((item: any, index: number) => (
                <div key={item.visual_id || `point-${index}`} className="space-y-2 border-t border-gray-100 pt-2 first:border-t-0 first:pt-0">
                  <div className="truncate text-[10px] font-semibold text-gray-500">{item.visual_id || item.icon || `point ${index + 1}`}</div>
                  <div className="grid grid-cols-2 gap-2">
                    {renderField('W', Array.isArray(item.size) ? item.size[0] : item.style?.size?.[0] || item.width, (value) => {
                      const next = numberValue(value, 28);
                      if (Array.isArray(item.size)) updateStyleSection('Point', index, ['size', 0], next);
                      else updateStyleSection('Point', index, ['style', 'size', 0], next);
                    })}
                    {renderField('H', Array.isArray(item.size) ? item.size[1] : item.style?.size?.[1] || item.height, (value) => {
                      const next = numberValue(value, 28);
                      if (Array.isArray(item.size)) updateStyleSection('Point', index, ['size', 1], next);
                      else updateStyleSection('Point', index, ['style', 'size', 1], next);
                    })}
                  </div>
                  {renderField('Icon prompt', item.icon_description || item.description, (value) => updateStyleSection('Point', index, ['icon_description'], value), { multiline: true })}
                  {renderField('URL', item.url, (value) => updateStyleSection('Point', index, ['url'], value))}
                </div>
              ))}
            </div>
          </details>
        )}
        {routesForStyle.length > 0 && (
          <details className="rounded border border-gray-200 bg-white p-2">
            <summary className="cursor-pointer text-[10px] font-semibold text-gray-700">Route</summary>
            <div className="mt-2 space-y-3">
              {routesForStyle.map((item: any, index: number) => (
                <div key={item.visual_id || `route-${index}`} className="space-y-2 border-t border-gray-100 pt-2 first:border-t-0 first:pt-0">
                  <div className="truncate text-[10px] font-semibold text-gray-500">{item.visual_id || `route ${index + 1}`}</div>
                  {renderColorField('Color', item.Color || item.color, (value) => {
                    updateEditorJson((draft) => {
                      if (!Array.isArray(draft.Route)) draft.Route = [];
                      if (!draft.Route[index]) draft.Route[index] = {};
                      draft.Route[index].Color = value;
                      draft.Route[index].color = value;
                    });
                  })}
                  {renderField('Width', item.width, (value) => updateStyleSection('Route', index, ['width'], numberValue(value, 4)))}
                </div>
              ))}
            </div>
          </details>
        )}
        {iconMeta && (
          <div className="rounded border border-gray-200 bg-white p-2 text-[10px] text-gray-600">
            <div className="font-semibold text-gray-700">Generation</div>
            <div>generated: {iconMeta.generated_count ?? 0}</div>
            <div>errors: {asArray(iconMeta.errors).length}</div>
          </div>
        )}
      </div>
    );
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
              {selectedAgentEvent?.label || getNodeTitle(selectedAgentEvent)}
            </div>
          </div>
          {renderNodeInfo()}
          {renderMapFeatureProperties()}
          {renderIntentProperties()}
          {renderValidationProperties()}
          {renderVisualProperties()}
          {renderGeojsonProperties()}
          {renderStyleProperties()}
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
