// API 配置
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';

// 构建完整的 API URL
export const buildApiUrl = (path: string): string => {
  return `${API_BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
};

// 构建文件 URL
export const buildFileUrl = (filename: string): string => {
  return `${API_BASE_URL}/files/${encodeURIComponent(filename)}`;
};

export type SaveSessionGeojsonParams = {
  sessionId: string;
  geojson: any;
  filename?: string;
  category?: 'origin' | 'layout' | 'groundtruth';
};

export const saveSessionGeojson = async ({
  sessionId,
  geojson,
  filename,
  category = 'origin',
}: SaveSessionGeojsonParams): Promise<{ success: boolean; filepath?: string; error?: string }> => {
  const res = await fetch(`${API_BASE_URL}/api/multimodal/session/${sessionId}/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ geojson, filename, category }),
  });
  const data = await res.json();
  return data;
};

export type MapInfo = {
  center: { lng: number; lat: number };
  bounds: { north: number; south: number; east: number; west: number };
};

export type RevisionScope =
  | { type: 'global'; allowedTargets?: string[]; allowedProperties?: string[] }
  | { type: 'node'; nodeId: string; allowedTargets?: string[]; allowedProperties?: string[] }
  | { type: 'element'; elementId: string; elementType: 'label' | 'route' | 'poi' | 'area'; allowedProperties?: string[] };

export type LabelLayoutItem = {
  id: string;
  text: string;
  poiId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  zoomLevel?: number;
  hierarchy: 'primary' | 'secondary' | 'detail';
  visible: boolean;
  locked?: boolean;
  manuallyEdited?: boolean;
  overlapState?: {
    hasOverlap: boolean;
    overlappingWith?: string[];
  };
  anchor?: { x: number; y: number };
  bbox?: { left: number; top: number; right: number; bottom: number };
};

export type ManualEditState = {
  lockedElements: string[];
  editedProperties: Record<string, {
    properties: string[];
    timestamp: string;
    source: 'manual_drag' | 'inspector_edit' | 'chat_request';
  }>;
  preserveManualEdits: boolean;
};

export type VLMRevisionInput = {
  mode: 'user_request' | 'final_review';
  userRequest?: string;
  scope: RevisionScope;
  geojson: any;
  styleJson: Record<string, any>;
  mapScreenshot: string;
  labelLayout: LabelLayoutItem[];
  manualEditState?: ManualEditState;
  selectedElementId?: string;
  selectedNodeId?: string;
  originalUserIntent?: string;
  reviewHistory?: VLMRevisionOutput[];
};

export type VLMRevisionOutput = {
  passed: boolean;
  reason: string;
  changedObjects: string[];
  changeSummary: string[];
  geojson: any;
  styleJson: Record<string, any>;
  labelLayout: LabelLayoutItem[];
  nextAction: 'apply' | 'rerun_review' | 'ask_user' | 'failed';
  warnings?: string[];
};

export const saveSessionMapInfo = async ({
  sessionId,
  mapInfo,
}: {
  sessionId: string;
  mapInfo: MapInfo;
}): Promise<{ success: boolean; filepath?: string; error?: string }> => {
  const res = await fetch(`${API_BASE_URL}/api/multimodal/session/${sessionId}/mapinfo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mapInfo }),
  });
  const data = await res.json();
  return data;
};

export const submitVlmReviewRevision = async (
  sessionId: string,
  input: VLMRevisionInput,
): Promise<VLMRevisionOutput> => {
  const res = await fetch(`${API_BASE_URL}/api/multimodal/session/${sessionId}/vlm-review-revision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    throw new Error('VLM review returned invalid JSON');
  }
  if (!res.ok || data.error) {
    throw new Error(data.error || 'VLM review request failed');
  }
  const warnings = Array.isArray(data.warnings) ? [...data.warnings] : [];
  if (typeof data.passed !== 'boolean') warnings.push('VLM output is missing "passed"; defaulted to false.');
  if (!data.geojson) warnings.push('VLM output is missing geojson; preserved current geojson.');
  if (!data.styleJson) warnings.push('VLM output is missing styleJson; preserved current styleJson.');
  if (!Array.isArray(data.labelLayout)) warnings.push('VLM output is missing labelLayout; preserved current label layout.');
  if (!Array.isArray(data.changedObjects)) warnings.push('VLM output is missing changedObjects; defaulted to an empty list.');
  if (!Array.isArray(data.changeSummary)) warnings.push('VLM output is missing changeSummary; defaulted to a generated summary.');
  return {
    passed: typeof data.passed === 'boolean' ? data.passed : false,
    reason: typeof data.reason === 'string' ? data.reason : warnings.join(' '),
    changedObjects: Array.isArray(data.changedObjects) ? data.changedObjects : [],
    changeSummary: Array.isArray(data.changeSummary)
      ? data.changeSummary
      : [warnings.length ? warnings.join(' ') : 'VLM review completed.'],
    geojson: data.geojson || input.geojson,
    styleJson: data.styleJson || input.styleJson,
    labelLayout: Array.isArray(data.labelLayout) ? data.labelLayout : input.labelLayout,
    nextAction: ['apply', 'rerun_review', 'ask_user', 'failed'].includes(data.nextAction)
      ? data.nextAction
      : 'apply',
    warnings,
  };
};
