import type { Rect } from './types';

export type Segment = { x1: number; y1: number; x2: number; y2: number };

export type SampledObstacleInput = {
  pointsPx: Array<{ x: number; y: number }>;
  /** polyline samples already in px */
  linesPx: Array<Array<{ x: number; y: number }>>;
  /** polygon rings samples already in px */
  polygonsPx: Array<Array<Array<{ x: number; y: number }>>>;
};

export type ObstacleParams = {
  /** Point obstacle radius (px) */
  pointRadius: number;
  /** Line obstacle half-width (px) */
  lineHalfWidth: number;
  /** Polygon outline half-width (px) */
  polygonHalfWidth: number;
  /** Downsample distance for lines (px) */
  lineSampleStep: number;
};

function rectFromCenter(x: number, y: number, halfW: number, halfH: number): Rect {
  return { x: x - halfW, y: y - halfH, width: halfW * 2, height: halfH * 2 };
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function samplePolyline(poly: Array<{ x: number; y: number }>, step: number) {
  if (poly.length <= 1) return poly.slice();
  const out: Array<{ x: number; y: number }> = [poly[0]];
  let acc = 0;
  for (let i = 1; i < poly.length; i++) {
    const p0 = poly[i - 1];
    const p1 = poly[i];
    const segLen = dist(p0, p1);
    acc += segLen;
    if (acc >= step) {
      out.push(p1);
      acc = 0;
    }
  }
  if (out[out.length - 1] !== poly[poly.length - 1]) out.push(poly[poly.length - 1]);
  return out;
}

export function buildObstacleRects(input: SampledObstacleInput, params: ObstacleParams): Rect[] {
  const rects: Rect[] = [];

  for (const p of input.pointsPx) {
    rects.push(rectFromCenter(p.x, p.y, params.pointRadius, params.pointRadius));
  }

  for (const line of input.linesPx) {
    const samples = samplePolyline(line, params.lineSampleStep);
    for (const p of samples) {
      rects.push(rectFromCenter(p.x, p.y, params.lineHalfWidth, params.lineHalfWidth));
    }
  }

  for (const poly of input.polygonsPx) {
    for (const ring of poly) {
      const samples = samplePolyline(ring, params.lineSampleStep);
      for (const p of samples) {
        rects.push(rectFromCenter(p.x, p.y, params.polygonHalfWidth, params.polygonHalfWidth));
      }
    }
  }

  return rects;
}

/**
 * Extract raw line segments from polylines and polygon rings.
 * Used for exact distance-transform repulsion (no sampling needed).
 */
export function buildObstacleSegments(
  input: Pick<SampledObstacleInput, 'linesPx' | 'polygonsPx'>
): Segment[] {
  const segs: Segment[] = [];

  for (const line of input.linesPx) {
    for (let i = 1; i < line.length; i++) {
      segs.push({ x1: line[i - 1].x, y1: line[i - 1].y, x2: line[i].x, y2: line[i].y });
    }
  }

  for (const poly of input.polygonsPx) {
    for (const ring of poly) {
      for (let i = 1; i < ring.length; i++) {
        segs.push({ x1: ring[i - 1].x, y1: ring[i - 1].y, x2: ring[i].x, y2: ring[i].y });
      }
    }
  }

  return segs;
}

