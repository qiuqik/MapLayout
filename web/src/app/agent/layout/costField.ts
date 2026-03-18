import type { Rect } from './types';
import type { Segment } from './obstacles';

export type CostFieldParams = {
  width: number;
  height: number;
  cellSize: number;
  /** Gaussian kernel sigma in px */
  sigma: number;
  /** Multiply final force magnitude */
  strength: number;
  /** Obstacles expanded by this padding (px) */
  obstaclePadding: number;
};

export type CostField = {
  params: CostFieldParams;
  cols: number;
  rows: number;
  /** cost[row * cols + col] */
  cost: Float32Array;
  /** gradient in pixels (dCost/dx, dCost/dy) */
  gradX: Float32Array;
  gradY: Float32Array;
};

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function gaussian(d2: number, sigma: number) {
  const s2 = sigma * sigma;
  return Math.exp(-d2 / (2 * s2));
}

/** Exact squared distance from point (px,py) to line segment (seg). */
function pointToSegmentDist2(px: number, py: number, seg: Segment): number {
  const abx = seg.x2 - seg.x1;
  const aby = seg.y2 - seg.y1;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) {
    const dx = px - seg.x1, dy = py - seg.y1;
    return dx * dx + dy * dy;
  }
  const t = Math.max(0, Math.min(1, ((px - seg.x1) * abx + (py - seg.y1) * aby) / len2));
  const cx = seg.x1 + t * abx;
  const cy = seg.y1 + t * aby;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

function pointToRectDist2(px: number, py: number, r: Rect) {
  const dx = px < r.x ? r.x - px : px > r.x + r.width ? px - (r.x + r.width) : 0;
  const dy = py < r.y ? r.y - py : py > r.y + r.height ? py - (r.y + r.height) : 0;
  return dx * dx + dy * dy;
}

/**
 * Build a grid-based repulsion cost/gradient field from obstacle rectangles
 * expressed in screen pixel coordinates.
 */
export function buildCostFieldFromRects(
  obstacles: Rect[],
  params: CostFieldParams,
  segments: Segment[] = []
): CostField {
  const cols = Math.max(1, Math.ceil(params.width / params.cellSize));
  const rows = Math.max(1, Math.ceil(params.height / params.cellSize));
  const cost = new Float32Array(cols * rows);

  // Pre-pad obstacles.
  const padded: Rect[] = obstacles.map((o) => ({
    x: o.x - params.obstaclePadding,
    y: o.y - params.obstaclePadding,
    width: o.width + params.obstaclePadding * 2,
    height: o.height + params.obstaclePadding * 2,
  }));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) * params.cellSize;
      const y = (r + 0.5) * params.cellSize;

      // Distance to nearest obstacle rect.
      let bestD2 = Number.POSITIVE_INFINITY;
      for (const o of padded) {
        const d2 = pointToRectDist2(x, y, o);
        if (d2 < bestD2) bestD2 = d2;
      }

      // Exact distance to nearest line segment (distance transform).
      // obstaclePadding is subtracted to give segments a physical half-width,
      // matching the conceptual lineHalfWidth used in the rect-based approach.
      for (const seg of segments) {
        const rawDist = Math.sqrt(pointToSegmentDist2(x, y, seg));
        const d = Math.max(0, rawDist - params.obstaclePadding);
        const d2 = d * d;
        if (d2 < bestD2) bestD2 = d2;
      }

      const v = bestD2 === Number.POSITIVE_INFINITY ? 0 : gaussian(bestD2, params.sigma);
      cost[r * cols + c] = v;
    }
  }

  // Finite differences for gradient (in cost units per pixel).
  const gradX = new Float32Array(cols * rows);
  const gradY = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const cL = cost[r * cols + clamp(c - 1, 0, cols - 1)];
      const cR = cost[r * cols + clamp(c + 1, 0, cols - 1)];
      const cU = cost[clamp(r - 1, 0, rows - 1) * cols + c];
      const cD = cost[clamp(r + 1, 0, rows - 1) * cols + c];
      gradX[idx] = (cR - cL) / (2 * params.cellSize);
      gradY[idx] = (cD - cU) / (2 * params.cellSize);
    }
  }

  return { params, cols, rows, cost, gradX, gradY };
}

export function sampleCostFieldForce(
  field: CostField,
  x: number,
  y: number
): { fx: number; fy: number } {
  const { cellSize, strength } = field.params;
  const c = clamp(Math.floor(x / cellSize), 0, field.cols - 1);
  const r = clamp(Math.floor(y / cellSize), 0, field.rows - 1);
  const idx = r * field.cols + c;

  // Push opposite to gradient (downhill).
  const gx = field.gradX[idx];
  const gy = field.gradY[idx];
  return { fx: -gx * strength, fy: -gy * strength };
}

