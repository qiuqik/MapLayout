export type LngLat = { lng: number; lat: number };

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LayoutItemKind = 'label' | 'card';

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

export type LeaderLine = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

