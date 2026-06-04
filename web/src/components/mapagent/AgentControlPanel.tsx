'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCwIcon } from 'lucide-react';
import { API_BASE_URL, buildFileUrl } from '@/lib/api';
import { useAgentMap, type AgentRunEvent, type AgentSelection } from '@/lib/agentMapContext';

interface AgentControlPanelProps {
  sessionId?: string;
  selectedRouteId?: string | null;
  onRouteSelect?: (routeId: string | null) => void;
}

const editablePayload = (event: AgentRunEvent | null, selection?: AgentSelection | null) => {
  if (selection?.kind === 'map_feature') return selection.payload || {};
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

const numericListValue = (value: string, fallback: number[] = []) => {
  const next = value
    .split(/[,\s]+/)
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0);
  return next.length ? next : fallback;
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

const escapeSelectorValue = (value: string) => {
  if (typeof window !== 'undefined' && window.CSS?.escape) return window.CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
};

const openAncestorDetails = (element: HTMLElement | null, boundary: HTMLElement | null) => {
  let cursor: HTMLElement | null = element;
  while (cursor && cursor !== boundary) {
    if (cursor instanceof HTMLDetailsElement) cursor.open = true;
    cursor = cursor.parentElement;
  }
};

const getNodeTitle = (event: AgentRunEvent | null) => event?.node_id || event?.type || 'none';

const inputPayloadFromEvent = (event: AgentRunEvent | null) => {
  const payload = event?.payload || {};
  const input = payload.input || payload;
  const prompt = input.user_text || input.message || payload.message || '';
  const imageName = input.image_filename || input.imageFilename || payload.imageFilename || '';
  return {
    prompt,
    imageName,
    imageUrl: imageName ? buildFileUrl(String(imageName)) : '',
  };
};

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
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const mapFeatureRef = useRef<HTMLDivElement | null>(null);

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

  const selectedNodeId = selectedAgentSelection?.node_id || selectedAgentEvent?.node_id || selectedAgentEvent?.type || null;
  const isMapFeatureSelected = selectedAgentSelection?.kind === 'map_feature';
  const isInputNodeSelected = selectedAgentSelection?.kind !== 'map_feature' && selectedAgentEvent?.node_id === 'input';
  const canRerun = Boolean(
    selectedAgentEvent &&
    ['intent', 'visual', 'geojson', 'style', 'workflow_completed'].includes(
      selectedAgentEvent.node_id || selectedAgentEvent.type,
    )
  );

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

  const updateManifestStyleSection = (
    section: 'Point' | 'Route' | 'Label' | 'Global',
    index: number,
    updater: (item: any) => void,
  ) => {
    const nextManifest = clone(manifest || {});
    if (!Array.isArray(nextManifest[section])) nextManifest[section] = [];
    if (!nextManifest[section][index]) nextManifest[section][index] = {};
    updater(nextManifest[section][index]);
    setManifest(nextManifest);

    if (selectedAgentSelection?.kind === 'map_feature') {
      const styleKey = section === 'Global'
        ? 'globalStyle'
        : section === 'Label'
          ? 'labelStyle'
          : section === 'Route'
            ? 'routeStyle'
            : 'pointStyle';
      const nextPayload = {
        ...selectedAgentSelection.payload,
        styleSection: section,
        styleIndex: index,
        [styleKey]: nextManifest[section][index],
      };
      setSelectedAgentSelection({
        ...selectedAgentSelection,
        payload: nextPayload,
      });
      setEditorText(JSON.stringify(nextPayload, null, 2));
    }
  };

  const updateStyleSectionLive = (
    section: 'Point' | 'Route' | 'Label' | 'Global',
    index: number,
    path: (string | number)[],
    value: any,
  ) => {
    if (selectedAgentSelection?.kind === 'map_feature') {
      updateManifestStyleSection(section, index, (item) => setNestedValue(item, path, value));
      return;
    }
    updateStyleSection(section, index, path, value);
  };

  const updateRouteColor = (index: number, value: string) => {
    if (selectedAgentSelection?.kind === 'map_feature') {
      updateManifestStyleSection('Route', index, (item) => {
        item.Color = value;
        item.color = value;
      });
      return;
    }
    updateEditorJson((draft) => {
      if (!Array.isArray(draft.Route)) draft.Route = [];
      if (!draft.Route[index]) draft.Route[index] = {};
      draft.Route[index].Color = value;
      draft.Route[index].color = value;
    });
  };

  const updateSelectedManifestStyle = (path: (string | number)[], value: any) => {
    const section = selectedAgentSelection?.payload?.styleSection as 'Label' | 'Global' | undefined;
    const index = Number(selectedAgentSelection?.payload?.styleIndex);
    if (!section || !Number.isInteger(index) || index < 0) return;
    const nextManifest = clone(manifest || {});
    if (!Array.isArray(nextManifest[section])) nextManifest[section] = [];
    if (!nextManifest[section][index]) nextManifest[section][index] = {};
    setNestedValue(nextManifest[section][index], path, value);
    setManifest(nextManifest);

    if (selectedAgentSelection) {
      const styleKey = section === 'Global' ? 'globalStyle' : 'labelStyle';
      const nextPayload = {
        ...selectedAgentSelection.payload,
        [styleKey]: nextManifest[section][index],
      };
      setSelectedAgentSelection({
        ...selectedAgentSelection,
        payload: nextPayload,
      });
      setEditorText(JSON.stringify(nextPayload, null, 2));
    }
  };

  const updateSelectedGlobalContent = (path: (string | number)[], value: any) => {
    const index = Number(selectedAgentSelection?.payload?.styleIndex);
    if (!Number.isInteger(index) || index < 0) return;
    const nextGeojson = clone(geojson || {});
    if (!Array.isArray(nextGeojson.global_properties)) nextGeojson.global_properties = [];
    if (!nextGeojson.global_properties[index]) nextGeojson.global_properties[index] = {};
    setNestedValue(nextGeojson.global_properties[index], path, value);
    setGeojson(nextGeojson);

    if (selectedAgentSelection) {
      const nextPayload = {
        ...selectedAgentSelection.payload,
        globalContent: nextGeojson.global_properties[index],
      };
      setSelectedAgentSelection({
        ...selectedAgentSelection,
        label: nextGeojson.global_properties[index]?.title || selectedAgentSelection.label,
        payload: nextPayload,
      });
      setEditorText(JSON.stringify(nextPayload, null, 2));
    }
  };

  const updateVisualPath = (path: (string | number)[], value: any) => {
    updateEditorJson((draft) => setNestedValue(draft, path, value), true);
  };

  useEffect(() => {
    if (!isMapFeatureSelected) return;
    const timer = window.setTimeout(() => {
      const payload = selectedAgentSelection?.payload || {};
      const section = payload.styleSection;
      const index = Number(payload.styleIndex);
      const visualId = payload.feature?.properties?.visual_id || payload.routeStyle?.visual_id || selectedRouteId;
      let target: HTMLElement | null = null;

      if (selectedAgentSelection?.node_id === 'map_line' && visualId) {
        target = scrollRootRef.current?.querySelector(
          `[data-route-control-id="${escapeSelectorValue(String(visualId))}"]`,
        ) as HTMLElement | null;
      } else if (section && Number.isInteger(index) && index >= 0) {
        target = scrollRootRef.current?.querySelector(
          `[data-style-section="${escapeSelectorValue(String(section))}"][data-style-index="${index}"]`,
        ) as HTMLElement | null;
      }

      if (target) {
        openAncestorDetails(target, scrollRootRef.current);
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }

      mapFeatureRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [isMapFeatureSelected, selectedAgentSelection, selectedRouteId]);

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

  const renderField = (
    label: string,
    value: any,
    onChange: (value: string) => void,
    options?: { multiline?: boolean; placeholder?: string },
  ) => (
    <label className="block min-w-0 space-y-1 text-[10px] text-gray-600">
      <span className="block truncate font-medium text-gray-700">{label}</span>
      {options?.multiline ? (
        <textarea
          value={textValue(value)}
          placeholder={options.placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-[52px] w-full min-w-0 resize-y rounded border border-gray-200 px-2 py-1 text-[11px] leading-4"
        />
      ) : (
        <input
          value={textValue(value)}
          placeholder={options?.placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="h-7 w-full min-w-0 rounded border border-gray-200 px-2 text-[11px]"
        />
      )}
    </label>
  );

  const renderColorField = (label: string, value: any, onChange: (value: string) => void) => (
    <label className="grid w-full min-w-0 grid-cols-[minmax(0,64px)_minmax(0,1fr)_28px] items-center gap-1.5 text-[10px] text-gray-600">
      <span className="min-w-0 truncate font-medium text-gray-700" title={label}>{label}</span>
      <input
        value={textValue(value)}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 min-w-0 rounded border border-gray-200 px-1.5 font-mono text-[10px]"
      />
      <input
        type="color"
        value={isHex(value) ? value : '#000000'}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 w-7 shrink-0 rounded border p-0"
      />
    </label>
  );

  const renderLeaderLineControls = (
    item: any,
    onUpdate: (path: (string | number)[], value: any) => void,
  ) => {
    const leader = item?.leaderLine && typeof item.leaderLine === 'object' ? item.leaderLine : {};
    const linePattern = leader.linePattern || (leader.dashArray || leader.dasharray ? 'dashed' : 'solid');
    const updateColor = (value: string) => {
      onUpdate(['leaderLine', 'Color'], value);
      onUpdate(['leaderLine', 'color'], value);
    };
    return (
      <div className="space-y-2 rounded border border-gray-100 bg-gray-50 p-2">
        <div className="text-[10px] font-semibold text-gray-700">Leader Line</div>
        {renderColorField('Color', leader.Color || leader.color, updateColor)}
        <div className="grid grid-cols-2 gap-2">
          {renderField('Width', leader.width ?? 1, (value) => onUpdate(['leaderLine', 'width'], numberValue(value, leader.width ?? 1)))}
          {renderField('Opacity', leader.opacity ?? 0.55, (value) => onUpdate(['leaderLine', 'opacity'], Math.max(0, Math.min(1, numberValue(value, leader.opacity ?? 0.55)))))}
        </div>
        <div className="grid grid-cols-2 gap-1">
          {(['solid', 'dashed'] as const).map((pattern) => (
            <button
              key={pattern}
              type="button"
              onClick={() => onUpdate(['leaderLine', 'linePattern'], pattern)}
              className={`min-w-0 truncate rounded border px-1.5 py-1 text-[10px] ${
                linePattern === pattern
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {pattern}
            </button>
          ))}
        </div>
        {renderField('Dash', asArray(leader.dashArray || leader.dasharray).join(', '), (value) => onUpdate(['leaderLine', 'dashArray'], numericListValue(value, [3, 3])))}
        <label className="flex items-center justify-between rounded border border-gray-100 bg-white px-2 py-1.5 text-[10px] text-gray-700">
          <span className="font-medium">Arrow</span>
          <input
            type="checkbox"
            checked={Boolean(leader.arrow)}
            onChange={(event) => onUpdate(['leaderLine', 'arrow'], event.target.checked)}
            className="h-3.5 w-3.5"
          />
        </label>
      </div>
    );
  };

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

  const renderInputProperties = () => {
    if (!isInputNodeSelected) return null;
    const input = inputPayloadFromEvent(selectedAgentEvent);
    return (
      <div className="mb-3 space-y-3 rounded border border-gray-200 bg-gray-50 p-2">
        <div className="text-[11px] font-semibold text-gray-700">Input</div>
        {input.imageUrl ? (
          <div className="overflow-hidden rounded border border-gray-200 bg-white">
            <img
              src={input.imageUrl}
              alt={input.imageName || 'Reference image'}
              className="max-h-36 w-full object-contain"
            />
            <div className="truncate border-t border-gray-100 px-2 py-1 text-[10px] text-gray-500">
              {input.imageName}
            </div>
          </div>
        ) : (
          <div className="rounded border border-dashed border-gray-200 bg-white p-3 text-[10px] text-gray-400">
            No reference image
          </div>
        )}
        <details open className="rounded border border-gray-200 bg-white p-2">
          <summary className="cursor-pointer text-[10px] font-semibold text-gray-700">Prompt</summary>
          <div className="mt-2 whitespace-pre-wrap break-words rounded bg-gray-50 p-2 text-[11px] leading-4 text-gray-700">
            {input.prompt || 'No prompt'}
          </div>
        </details>
      </div>
    );
  };

  const renderMapFeatureProperties = () => {
    if (selectedAgentSelection?.kind !== 'map_feature' || !parsedEditor) return null;
    if (selectedAgentSelection.payload?.styleSection === 'Global') return null;
    const feature = parsedEditor.feature || parsedEditor;
    if (!feature?.geometry) return null;
    const props = feature.properties || {};
    const geometryType = feature.geometry?.type || selectedAgentSelection.payload?.geometryType;
    const linkedLabelStyleIndex = Number(selectedAgentSelection.payload?.labelStyleIndex);
    const linkedLabelStyle = Number.isInteger(linkedLabelStyleIndex) && linkedLabelStyleIndex >= 0
      ? manifest?.Label?.[linkedLabelStyleIndex] || selectedAgentSelection.payload?.labelStyle
      : null;
    return (
      <div ref={mapFeatureRef} className="mb-3 scroll-mt-3 space-y-3 rounded border border-gray-300 bg-gray-50 p-2 ring-1 ring-gray-200">
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
        {linkedLabelStyle && renderLeaderLineControls(
          linkedLabelStyle,
          (path, value) => updateStyleSectionLive('Label', linkedLabelStyleIndex, path, value),
        )}
      </div>
    );
  };

  const renderMapSelectionStyleProperties = () => {
    if (selectedAgentSelection?.kind !== 'map_feature') return null;
    const section = selectedAgentSelection.payload?.styleSection as 'Label' | 'Global' | undefined;
    const index = Number(selectedAgentSelection.payload?.styleIndex);
    if (!section || !['Label', 'Global'].includes(section) || !Number.isInteger(index) || index < 0) return null;

    const item = section === 'Global'
      ? manifest?.Global?.[index] || selectedAgentSelection.payload?.globalStyle || {}
      : manifest?.Label?.[index] || selectedAgentSelection.payload?.labelStyle || {};
    const content = selectedAgentSelection.payload?.globalContent || {};

    if (section === 'Global') {
      const container = item.style?.container || {};
      return (
        <div className="mb-3 space-y-3 rounded border border-gray-200 bg-gray-50 p-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-semibold text-gray-700">Global Style</div>
            <div className="text-[10px] text-gray-500">#{index + 1}</div>
          </div>
          {renderField('Title', content.title, (value) => updateSelectedGlobalContent(['title'], value))}
          {renderField('Script', content.script, (value) => updateSelectedGlobalContent(['script'], value), { multiline: true })}
          {renderField('Extra', content.extra_info, (value) => updateSelectedGlobalContent(['extra_info'], value), { multiline: true })}
          <div className="grid grid-cols-2 gap-2">
            {renderField('Width', container.width, (value) => updateSelectedManifestStyle(['style', 'container', 'width'], numberValue(value, container.width)))}
            {renderField('Height', container.height, (value) => updateSelectedManifestStyle(['style', 'container', 'height'], numberValue(value, container.height)))}
          </div>
          {renderColorField('Panel', container.backgroundColor || container.background, (value) => updateSelectedManifestStyle(['style', 'container', 'backgroundColor'], value))}
          {renderColorField('Title', item.style?.title?.color || container.color, (value) => updateSelectedManifestStyle(['style', 'title', 'color'], value))}
          {renderColorField('Script', item.style?.script?.color, (value) => updateSelectedManifestStyle(['style', 'script', 'color'], value))}
          {renderColorField('Extra', item.style?.extra_info?.color, (value) => updateSelectedManifestStyle(['style', 'extra_info', 'color'], value))}
        </div>
      );
    }

    return (
      <div className="mb-3 space-y-3 rounded border border-gray-200 bg-gray-50 p-2">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold text-gray-700">Label Style</div>
          <div className="max-w-[120px] truncate text-[10px] text-gray-500">{item.visual_id || item.hierarchy || `#${index + 1}`}</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {renderField('Width', item.width, (value) => updateSelectedManifestStyle(['width'], numberValue(value, item.width)))}
          {renderField('Height', item.height, (value) => updateSelectedManifestStyle(['height'], numberValue(value, item.height)))}
        </div>
        {renderColorField('Panel', item.style?.container?.backgroundColor || item.style?.container?.background || item.style?.backgroundColor || item.style?.background, (value) => updateSelectedManifestStyle(['style', 'container', 'backgroundColor'], value))}
        {renderColorField('Title', item.style?.title?.color, (value) => updateSelectedManifestStyle(['style', 'title', 'color'], value))}
        {renderColorField('Script', item.style?.script?.color, (value) => updateSelectedManifestStyle(['style', 'script', 'color'], value))}
        {renderColorField('Extra', item.style?.extra_info?.color, (value) => updateSelectedManifestStyle(['style', 'extra_info', 'color'], value))}
        {renderLeaderLineControls(item, updateSelectedManifestStyle)}
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
    const themeKey = parsedEditor['Theme&Design'] ? 'Theme&Design' : 'ThemeDesign';
    const themeDesign = parsedEditor[themeKey] || {};
    const colorSpec = parsedEditor.Color || {};
    const palette = asArray(parsedEditor.Color?.palette);
    const stylesheetLayers = asArray(parsedEditor.Stylesheet?.layers);
    return (
      <div className="mb-3 space-y-3 rounded border border-gray-200 bg-gray-50 p-2">
        <div className="text-[11px] font-semibold text-gray-700">Visual</div>
        <details className="rounded border border-gray-200 bg-white p-2">
          <summary className="cursor-pointer text-[10px] font-semibold text-gray-700">Theme&Design</summary>
          <div className="mt-2 space-y-2">
            {renderField('Global', themeDesign.global, (value) => updateVisualPath([themeKey, 'global'], value))}
            {renderField('Theme', themeDesign.theme, (value) => updateVisualPath([themeKey, 'theme'], value))}
            {renderField('Keywords', asArray(themeDesign.design_keywords).join(', '), (value) => updateVisualPath([themeKey, 'design_keywords'], value.split(',').map((item) => item.trim()).filter(Boolean)))}
            {renderField('Visual language', themeDesign.visual_language, (value) => updateVisualPath([themeKey, 'visual_language'], value), { multiline: true })}
            {renderField('Label design', themeDesign.label_design, (value) => updateVisualPath([themeKey, 'label_design'], value), { multiline: true })}
            {renderField('Route design', themeDesign.route_design, (value) => updateVisualPath([themeKey, 'route_design'], value), { multiline: true })}
            {renderField('Icon design', themeDesign.icon_design, (value) => updateVisualPath([themeKey, 'icon_design'], value), { multiline: true })}
          </div>
        </details>
        <details className="rounded border border-gray-200 bg-white p-2">
          <summary className="cursor-pointer text-[10px] font-semibold text-gray-700">Color</summary>
          <div className="mt-2 space-y-2">
            {['background', 'water', 'road'].map((key) => (
              <div key={key}>
                {renderColorField(key, colorSpec?.[key], (value) => updateVisualPath(['Color', key], value))}
              </div>
            ))}
            {['primary', 'secondary', 'inverse'].map((key) => (
              <div key={`text-${key}`}>
                {renderColorField(`text.${key}`, colorSpec?.text?.[key], (value) => updateVisualPath(['Color', 'text', key], value))}
              </div>
            ))}
            {['primary', 'secondary'].map((key) => (
              <div key={`accent-${key}`}>
                {renderColorField(`accent.${key}`, colorSpec?.accent?.[key], (value) => updateVisualPath(['Color', 'accent', key], value))}
              </div>
            ))}
          </div>
        </details>
        {palette.length > 0 && (
          <details className="rounded border border-gray-200 bg-white p-2">
            <summary className="cursor-pointer text-[10px] font-semibold text-gray-700">Palette</summary>
            <div className="mt-2 space-y-2">
            {palette.slice(0, 10).map((item: any, index: number) => (
              <div key={`${item.name || 'color'}-${index}`} className="min-w-0 space-y-2 overflow-hidden rounded border border-gray-100 bg-gray-50 p-2">
                <label className="grid min-w-0 grid-cols-[minmax(0,1fr)_28px] items-center gap-1.5 text-[10px] text-gray-600">
                  <input
                    value={textValue(item.name || `color ${index + 1}`)}
                    onChange={(event) => updateVisualPath(['Color', 'palette', index, 'name'], event.target.value)}
                    className="h-7 min-w-0 rounded border border-gray-200 px-2 text-[10px]"
                  />
                  <input
                    type="color"
                    value={isHex(item.hex) ? item.hex : '#000000'}
                    onChange={(event) => updateVisualPath(['Color', 'palette', index, 'hex'], event.target.value)}
                    className="h-7 w-7 shrink-0 rounded border p-0"
                  />
                </label>
                <div className="grid min-w-0 grid-cols-2 gap-2">
                  {renderField('Usage', item.usage, (value) => updateVisualPath(['Color', 'palette', index, 'usage'], value))}
                  {renderField('Weight', item.weight, (value) => updateVisualPath(['Color', 'palette', index, 'weight'], numberValue(value, item.weight)))}
                </div>
              </div>
            ))}
            </div>
          </details>
        )}
        {parsedEditor.Stylesheet && (
          <details className="rounded border border-gray-200 bg-white p-2">
            <summary className="cursor-pointer text-[10px] font-semibold text-gray-700">Stylesheet</summary>
            <div className="mt-2 space-y-2">
              {renderField('Global', parsedEditor.Stylesheet.global, (value) => updateVisualPath(['Stylesheet', 'global'], value))}
              {renderField('Mapbox style', parsedEditor.Stylesheet.mapboxStyle, (value) => updateVisualPath(['Stylesheet', 'mapboxStyle'], value))}
            </div>
          </details>
        )}
        {stylesheetLayers.length > 0 && (
          <details className="rounded border border-gray-200 bg-white p-2">
            <summary className="cursor-pointer text-[10px] font-semibold text-gray-700">Stylesheet Layers</summary>
            <div className="mt-2 space-y-2">
              {stylesheetLayers.map((layer: any, index: number) => {
                const paintEntries = Object.entries(layer?.paint || {});
                return (
                  <div key={`${layer?.target || 'layer'}-${index}`} className="min-w-0 space-y-2 overflow-hidden rounded border border-gray-100 bg-gray-50 p-2">
                    {renderField('Target', layer?.target, (value) => updateVisualPath(['Stylesheet', 'layers', index, 'target'], value))}
                    {paintEntries.length === 0 ? (
                      <div className="text-[10px] text-gray-400">No paint values</div>
                    ) : (
                      paintEntries.map(([paintKey, paintValue]) => (
                        <div key={paintKey}>
                          {isHex(paintValue)
                            ? renderColorField(paintKey, paintValue, (value) => updateVisualPath(['Stylesheet', 'layers', index, 'paint', paintKey], value))
                            : renderField(paintKey, paintValue, (value) => updateVisualPath(['Stylesheet', 'layers', index, 'paint', paintKey], value))}
                        </div>
                      ))
                    )}
                  </div>
                );
              })}
            </div>
          </details>
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
          <details className="rounded border border-gray-200 bg-white p-2">
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
            <details key={String(dayKey)} className="rounded border border-gray-200 bg-white p-2">
              <summary className="cursor-pointer text-[10px] font-semibold text-gray-700">{String(dayKey)}</summary>
              <div className="mt-2 space-y-2">
                {dayPoints.map(({ feature, index }) => {
                  const props = feature.properties || {};
                  return (
                    <details
                      key={[
                        props.feature_id,
                        props.visual_id,
                        props.day,
                        props.order,
                        props.name || props.label_title,
                        index,
                      ].filter(Boolean).join('-')}
                      className="rounded border border-gray-100 bg-gray-50 p-2"
                    >
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
    const selectedStyleSection = selectedAgentSelection?.payload?.styleSection;
    const isMapStyleSelection = selectedAgentSelection?.kind === 'map_feature' &&
      ['Route', 'Label', 'Global', 'Point'].includes(String(selectedStyleSection));
    if (!['style', 'icon_generation'].includes(selectedNodeId || '') && !isMapStyleSelection) return null;
    const styleSource = isMapStyleSelection ? manifest : parsedEditor;
    if (!styleSource) return null;
    const points = asArray(styleSource.Point);
    const labels = asArray(styleSource.Label);
    const globals = asArray(styleSource.Global);
    const routesForStyle = asArray(styleSource.Route);
    const iconMeta = isMapStyleSelection ? null : parsedEditor?._icon_generation;
    const openGlobalSection = selectedStyleSection === 'Global';
    const openLabelSection = selectedStyleSection === 'Label';
    const openPointSection = selectedStyleSection === 'Point';
    const openRouteSection = selectedStyleSection === 'Route' || Boolean(selectedRouteId);

    return (
      <div className="mb-3 space-y-3 rounded border border-gray-200 bg-gray-50 p-2">
        <div className="text-[11px] font-semibold text-gray-700">{selectedNodeId === 'icon_generation' ? 'Icons' : 'Style'}</div>
        {globals.length > 0 && (
          <details open={openGlobalSection} className="rounded border border-gray-200 bg-white p-2">
            <summary className="cursor-pointer text-[10px] font-semibold text-gray-700">Global</summary>
            <div className="mt-2 space-y-3">
              {globals.map((item: any, index: number) => (
                <div
                  key={`style-global-${index}`}
                  data-style-section="Global"
                  data-style-index={index}
                  className={`scroll-mt-4 space-y-2 border-t border-gray-100 pt-2 first:border-t-0 first:pt-0 ${
                    openGlobalSection && Number(selectedAgentSelection?.payload?.styleIndex) === index
                      ? 'rounded border border-[#131722] bg-[#F2F2F2] p-2'
                      : ''
                  }`}
                >
                  {renderField('Title', item.content?.title, (value) => updateStyleSectionLive('Global', index, ['content', 'title'], value))}
                  {renderField('Script', item.content?.script, (value) => updateStyleSectionLive('Global', index, ['content', 'script'], value), { multiline: true })}
                  {renderField('Extra', item.content?.extra_info, (value) => updateStyleSectionLive('Global', index, ['content', 'extra_info'], value), { multiline: true })}
                  <div className="grid grid-cols-2 gap-2">
                    {renderField('Width', item.style?.container?.width, (value) => updateStyleSectionLive('Global', index, ['style', 'container', 'width'], numberValue(value, item.style?.container?.width)))}
                    {renderField('Height', item.style?.container?.height, (value) => updateStyleSectionLive('Global', index, ['style', 'container', 'height'], numberValue(value, item.style?.container?.height)))}
                  </div>
                  {renderColorField('Text', item.style?.title?.color || item.style?.container?.color, (value) => updateStyleSectionLive('Global', index, ['style', 'title', 'color'], value))}
                  {renderColorField('Panel', item.style?.container?.backgroundColor || item.style?.container?.background, (value) => updateStyleSectionLive('Global', index, ['style', 'container', 'backgroundColor'], value))}
                </div>
              ))}
            </div>
          </details>
        )}
        {labels.length > 0 && (
          <details open={openLabelSection} className="rounded border border-gray-200 bg-white p-2">
            <summary className="cursor-pointer text-[10px] font-semibold text-gray-700">Label</summary>
            <div className="mt-2 space-y-3">
              {labels.map((item: any, index: number) => (
                <div
                  key={`label-${item.visual_id || 'item'}-${index}`}
                  data-style-section="Label"
                  data-style-index={index}
                  className={`scroll-mt-4 space-y-2 border-t border-gray-100 pt-2 first:border-t-0 first:pt-0 ${
                    openLabelSection && Number(selectedAgentSelection?.payload?.styleIndex) === index
                      ? 'rounded border border-[#131722] bg-[#F2F2F2] p-2'
                      : ''
                  }`}
                >
                  <div className="truncate text-[10px] font-semibold text-gray-500">{item.visual_id || `label ${index + 1}`}</div>
                  <div className="grid grid-cols-2 gap-2">
                    {renderField('Width', item.width, (value) => updateStyleSectionLive('Label', index, ['width'], numberValue(value, item.width)))}
                    {renderField('Height', item.height, (value) => updateStyleSectionLive('Label', index, ['height'], numberValue(value, item.height)))}
                  </div>
                  <label className="block space-y-1 text-[10px] text-gray-600">
                    <span className="font-medium text-gray-700">Level</span>
                    <select
                      value={item.hierarchy || item.level || 'secondary'}
                      onChange={(event) => updateStyleSectionLive('Label', index, ['hierarchy'], event.target.value)}
                      className="h-7 w-full rounded border border-gray-200 px-2 text-[11px]"
                    >
                      <option value="core">core</option>
                      <option value="secondary">secondary</option>
                      <option value="detail">detail</option>
                    </select>
                  </label>
                  {renderColorField('Title', item.style?.title?.color, (value) => updateStyleSectionLive('Label', index, ['style', 'title', 'color'], value))}
                  {renderColorField('Script', item.style?.script?.color, (value) => updateStyleSectionLive('Label', index, ['style', 'script', 'color'], value))}
                  {renderColorField('Extra', item.style?.extra_info?.color, (value) => updateStyleSectionLive('Label', index, ['style', 'extra_info', 'color'], value))}
                  {renderLeaderLineControls(item, (path, value) => updateStyleSectionLive('Label', index, path, value))}
                </div>
              ))}
            </div>
          </details>
        )}
        {points.length > 0 && (
          <details open={openPointSection} className="rounded border border-gray-200 bg-white p-2">
            <summary className="cursor-pointer text-[10px] font-semibold text-gray-700">Point</summary>
            <div className="mt-2 space-y-3">
              {points.map((item: any, index: number) => (
                <div
                  key={`point-${item.visual_id || item.icon || 'item'}-${index}`}
                  data-style-section="Point"
                  data-style-index={index}
                  className="scroll-mt-4 space-y-2 border-t border-gray-100 pt-2 first:border-t-0 first:pt-0"
                >
                  <div className="truncate text-[10px] font-semibold text-gray-500">{item.visual_id || item.icon || `point ${index + 1}`}</div>
                  <div className="grid grid-cols-2 gap-2">
                    {renderField('W', Array.isArray(item.size) ? item.size[0] : item.style?.size?.[0] || item.width, (value) => {
                      const next = numberValue(value, 28);
                      if (Array.isArray(item.size)) updateStyleSectionLive('Point', index, ['size', 0], next);
                      else updateStyleSectionLive('Point', index, ['style', 'size', 0], next);
                    })}
                    {renderField('H', Array.isArray(item.size) ? item.size[1] : item.style?.size?.[1] || item.height, (value) => {
                      const next = numberValue(value, 28);
                      if (Array.isArray(item.size)) updateStyleSectionLive('Point', index, ['size', 1], next);
                      else updateStyleSectionLive('Point', index, ['style', 'size', 1], next);
                    })}
                  </div>
                  {renderField('Icon prompt', item.icon_description || item.description, (value) => updateStyleSectionLive('Point', index, ['icon_description'], value), { multiline: true })}
                  {renderField('URL', item.url, (value) => updateStyleSectionLive('Point', index, ['url'], value))}
                </div>
              ))}
            </div>
          </details>
        )}
        {routesForStyle.length > 0 && (
          <details open={openRouteSection} className="rounded border border-gray-200 bg-white p-2">
            <summary className="cursor-pointer text-[10px] font-semibold text-gray-700">Route</summary>
            <div className="mt-2 space-y-3">
              {routesForStyle.map((item: any, index: number) => {
                const isSelectedRoute = selectedRouteId === item.visual_id ||
                  (selectedAgentSelection?.node_id === 'map_line' &&
                    selectedAgentSelection.payload?.feature?.properties?.visual_id === item.visual_id);
                return (
                <div
                  key={`route-${item.visual_id || 'item'}-${index}`}
                  data-route-control-id={item.visual_id || ''}
                  data-style-section="Route"
                  data-style-index={index}
                  className={`scroll-mt-4 space-y-2 border-t border-gray-100 pt-2 first:border-t-0 first:pt-0 ${
                    isSelectedRoute ? 'rounded border border-[#131722] bg-[#F2F2F2] p-2' : ''
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => item.visual_id && onRouteSelect?.(item.visual_id)}
                    className={`w-full truncate rounded border px-2 py-1 text-left text-[10px] font-semibold ${
                      selectedRouteId === item.visual_id
                        ? 'border-gray-900 bg-gray-900 text-white'
                        : 'border-gray-100 bg-gray-50 text-gray-600 hover:border-gray-200'
                    }`}
                  >
                    {item.visual_id || `route ${index + 1}`}
                  </button>
                  {renderColorField('Color', item.Color || item.color, (value) => updateRouteColor(index, value))}
                  <div className="space-y-1">
                    <div className="text-[10px] font-medium text-gray-700">Curve</div>
                    <div className="grid grid-cols-3 gap-1">
                      {(['straight', 'bezier', 'navigation'] as const).map((style) => (
                        <button
                          key={style}
                          type="button"
                          onClick={() => updateStyleSectionLive('Route', index, ['style'], style)}
                          className={`min-w-0 truncate rounded border px-1.5 py-1 text-[10px] ${
                            (item.style || 'bezier') === style
                              ? 'border-gray-900 bg-gray-900 text-white'
                              : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          {style}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {(['solid', 'dashed'] as const).map((linePattern) => (
                      <button
                        key={linePattern}
                        type="button"
                        onClick={() => updateStyleSectionLive('Route', index, ['linePattern'], linePattern)}
                        className={`min-w-0 truncate rounded border px-1.5 py-1 text-[10px] ${
                          (item.linePattern || (item.dashArray ? 'dashed' : 'solid')) === linePattern
                            ? 'border-gray-900 bg-gray-900 text-white'
                            : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {linePattern}
                      </button>
                    ))}
                  </div>
                  <label className="grid grid-cols-[44px_1fr_24px] items-center gap-2 text-[10px] text-gray-600">
                    <span className="font-medium text-gray-700">Width</span>
                    <input
                      type="range"
                      min={1}
                      max={12}
                      value={Number(item.width || 4)}
                      onChange={(event) => updateStyleSectionLive('Route', index, ['width'], Number(event.target.value))}
                      className="min-w-0"
                    />
                    <span className="text-right text-gray-500">{Number(item.width || 4)}</span>
                  </label>
                  <label className="flex items-center justify-between rounded border border-gray-100 bg-gray-50 px-2 py-1.5 text-[10px] text-gray-700">
                    <span className="font-medium">Arrow</span>
                    <input
                      type="checkbox"
                      checked={Boolean(item.arrow)}
                      onChange={(event) => updateStyleSectionLive('Route', index, ['arrow'], event.target.checked)}
                      className="h-3.5 w-3.5"
                    />
                  </label>
                </div>
                );
              })}
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
      <div className="agent-theme-control-header flex items-center justify-between border-b px-3 py-2">
        <div className="text-sm font-semibold">Controls</div>
        <button
          type="button"
          onClick={handleRerun}
          disabled={!sessionId || !canRerun || busy}
          className="agent-theme-primary-action flex h-7 items-center gap-1 rounded border px-2 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          title="Rerun downstream"
        >
          <RefreshCwIcon className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
          Rerun
        </button>
      </div>

      <div ref={scrollRootRef} className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
        <section>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold text-gray-700">Properties</div>
            <div className="max-w-[130px] truncate text-[10px] text-gray-500">
              {selectedAgentSelection?.label || selectedAgentEvent?.label || getNodeTitle(selectedAgentEvent)}
            </div>
          </div>
          {renderNodeInfo()}
          {renderInputProperties()}
          {renderMapFeatureProperties()}
          {renderMapSelectionStyleProperties()}
          {renderIntentProperties()}
          {renderValidationProperties()}
          {renderVisualProperties()}
          {renderGeojsonProperties()}
          {renderStyleProperties()}
        </section>
      </div>
    </aside>
  );
};

export default AgentControlPanel;
