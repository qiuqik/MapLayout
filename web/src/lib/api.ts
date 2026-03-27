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
