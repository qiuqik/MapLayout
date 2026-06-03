export type LngLat = { lng: number; lat: number };

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LayoutItemKind = 'label';
export type LayoutItemHierarchy = 'core' | 'secondary' | 'detail';
export type LayoutItemContentType = 'title' | 'title_script' | 'title_script_extra';

export type LayoutItemInput = {
  id: string;
  kind: LayoutItemKind;
  anchorLngLat: LngLat;
  /** HTML string rendered inside the box */
  html: string;
  /** Measured size (px) */
  width: number;
  height: number;
  /** Optional padding to keep away from repulsion field */
  padding?: number;
  hierarchy?: LayoutItemHierarchy;
  contentType?: LayoutItemContentType;
  scale?: number;
  hidden?: boolean;
};

export type LayoutItemOutput = LayoutItemInput & {
  /** Anchor in screen pixels (map.project) */
  anchorPx: { x: number; y: number };
  /** Final top-left of box in pixels */
  x: number;
  y: number;
  /** Box center in pixels */
  cx: number;
  cy: number;
  /** Box position in lng/lat */
  centerLngLat: LngLat;
};

export type LayoutItemPosition = {
  id: string;
  anchorLngLat: LngLat;
  centerLngLat: LngLat;
};

export type LayoutRunMetadata = {
  algorithm: string;
  seed: number;
  initialization: 'anchor' | 'force';
  pipeline: string[];
  runtimeMs: number;
  itemCount: number;
  viewport: { width: number; height: number };
  generatedAt: string;
  layoutParams?: Record<string, unknown>;
  fieldParams?: Record<string, unknown>;
};

export type LeaderLine = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};
