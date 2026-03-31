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