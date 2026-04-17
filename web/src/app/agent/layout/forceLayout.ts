import { forceSimulation, forceX, forceY } from 'd3-force';
import type { CostField } from './costField';
import { sampleCostFieldForce } from './costField';
import type { LayoutItemInput, LayoutItemOutput, LeaderLine, Rect } from './types';
import { rectCollideForce } from './rectCollide';
import type { Segment } from './obstacles';

export type LayoutParams = {
  /** Pull label/card center towards anchorPx */
  linkStrength: number;
  /** Rectangle collision strength */
  collideStrength: number;
  /** Field repulsion strength multiplier (already in field) */
  fieldStrength: number;
  /** Keep inside viewport */
  boundsPadding: number;
  /** Alpha settings */
  alpha: number;
  alphaDecay: number;
  alphaMin: number;
  iterations: number;
  /** Leader line threshold (px) */
  leaderThreshold: number;
};

export type LayoutContext = {
  viewport: { width: number; height: number };
  costField?: CostField;
  /** Line segments for hard collision (from lines and polygon outlines) */
  segments?: Segment[];
  /**
   * Global item bounding rects in map-container pixel space.
   * Used as hard-constraint obstacles in post-processing.
   * Soft repulsion is handled by including these rects in the cost field.
   */
  globalRects?: Rect[];
};

type SimNode = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  padding: number;
  anchorX: number;
  anchorY: number;
};

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Find the closest point on a line segment to a given point.
 */
function closestPointOnSegment(
  px: number, py: number,
  x1: number, y1: number, x2: number, y2: number
): { x: number; y: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: x1, y: y1 };
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return { x: x1 + t * dx, y: y1 + t * dy };
}

/**
 * Check if a rectangle (centered at cx,cy with given half-dimensions) overlaps
 * with a line segment. Returns the push vector to resolve the overlap.
 */
function rectSegmentOverlap(
  cx: number, cy: number, halfW: number, halfH: number,
  seg: Segment, padding: number
): { overlaps: boolean; pushX: number; pushY: number } {
  const paddedHalfW = halfW + padding;
  const paddedHalfH = halfH + padding;
  
  const minX = cx - paddedHalfW;
  const maxX = cx + paddedHalfW;
  const minY = cy - paddedHalfH;
  const maxY = cy + paddedHalfH;
  
  const segMinX = Math.min(seg.x1, seg.x2);
  const segMaxX = Math.max(seg.x1, seg.x2);
  const segMinY = Math.min(seg.y1, seg.y2);
  const segMaxY = Math.max(seg.y1, seg.y2);
  
  if (segMaxX < minX || segMinX > maxX || segMaxY < minY || segMinY > maxY) {
    return { overlaps: false, pushX: 0, pushY: 0 };
  }
  
  const closest = closestPointOnSegment(cx, cy, seg.x1, seg.y1, seg.x2, seg.y2);
  const dx = cx - closest.x;
  const dy = cy - closest.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  if (dist < 0.001) {
    const overlapX = paddedHalfW;
    const overlapY = paddedHalfH;
    if (overlapX < overlapY) {
      const sign = cx <= seg.x1 ? -1 : 1;
      return { overlaps: true, pushX: sign * (paddedHalfW + 1), pushY: 0 };
    } else {
      const sign = cy <= seg.y1 ? -1 : 1;
      return { overlaps: true, pushX: 0, pushY: sign * (paddedHalfH + 1) };
    }
  }
  
  const overlapX = paddedHalfW - Math.abs(dx);
  const overlapY = paddedHalfH - Math.abs(dy);
  
  if (overlapX > 0 && overlapY > 0) {
    if (overlapX < overlapY) {
      const sign = dx >= 0 ? 1 : -1;
      return { overlaps: true, pushX: sign * overlapX, pushY: 0 };
    } else {
      const sign = dy >= 0 ? 1 : -1;
      return { overlaps: true, pushX: 0, pushY: sign * overlapY };
    }
  }
  
  const px = Math.max(minX, Math.min(cx, seg.x1));
  const py = Math.max(minY, Math.min(cy, seg.y1));
  const px2 = Math.max(minX, Math.min(cx, seg.x2));
  const py2 = Math.max(minY, Math.min(cy, seg.y2));
  
  let minDist = dist;
  let pushX = 0;
  let pushY = 0;
  
  const checkPoint = (qx: number, qy: number) => {
    const dqx = cx - qx;
    const dqy = cy - qy;
    const d = Math.sqrt(dqx * dqx + dqy * dqy);
    if (d < minDist && d > 0.001) {
      minDist = d;
      const ox = paddedHalfW - Math.abs(dqx);
      const oy = paddedHalfH - Math.abs(dqy);
      if (ox > 0 && oy > 0) {
        if (ox < oy) {
          pushX = dqx >= 0 ? ox : -ox;
          pushY = 0;
        } else {
          pushX = 0;
          pushY = dqy >= 0 ? oy : -oy;
        }
      } else {
        const scale = Math.min(paddedHalfW - Math.abs(dqx), paddedHalfH - Math.abs(dqy));
        if (Math.abs(dqx) > Math.abs(dqy)) {
          pushX = dqx >= 0 ? scale : -scale;
          pushY = 0;
        } else {
          pushX = 0;
          pushY = dqy >= 0 ? scale : -scale;
        }
      }
    }
  };
  
  if (seg.x1 >= minX && seg.x1 <= maxX && seg.y1 >= minY && seg.y1 <= maxY) {
    checkPoint(seg.x1, seg.y1);
  }
  if (seg.x2 >= minX && seg.x2 <= maxX && seg.y2 >= minY && seg.y2 <= maxY) {
    checkPoint(seg.x2, seg.y2);
  }
  
  if (pushX !== 0 || pushY !== 0) {
    return { overlaps: true, pushX, pushY };
  }
  
  if (minDist < Math.min(paddedHalfW, paddedHalfH)) {
    const scale = Math.min(paddedHalfW, paddedHalfH) - minDist + 1;
    if (Math.abs(dx) > Math.abs(dy)) {
      const sign = dx >= 0 ? 1 : -1;
      return { overlaps: true, pushX: sign * scale, pushY: 0 };
    } else {
      const sign = dy >= 0 ? 1 : -1;
      return { overlaps: true, pushX: 0, pushY: sign * scale };
    }
  }
  
  return { overlaps: false, pushX: 0, pushY: 0 };
}

function boundingForce(ctx: LayoutContext, params: LayoutParams) {
  let nodes: SimNode[] = [];
  function force(alpha: number) {
    const pad = params.boundsPadding;
    const w = ctx.viewport.width;
    const h = ctx.viewport.height;
    for (const n of nodes) {
      const halfW = n.width / 2;
      const halfH = n.height / 2;
      const minX = pad + halfW;
      const maxX = w - pad - halfW;
      const minY = pad + halfH;
      const maxY = h - pad - halfH;

      const tx = clamp(n.x, minX, maxX);
      const ty = clamp(n.y, minY, maxY);
      n.vx += (tx - n.x) * alpha * 2;
      n.vy += (ty - n.y) * alpha * 2;
    }
  }
  force.initialize = (ns: any[]) => {
    nodes = ns as SimNode[];
  };
  return force as any;
}

function fieldRepulsionForce(ctx: LayoutContext, params: LayoutParams) {
  let nodes: SimNode[] = [];
  function force(alpha: number) {
    if (!ctx.costField) return;
    const k = alpha * params.fieldStrength;
    for (const n of nodes) {
      // Sample at center + 4 corners to account for the node's physical extent
      // and to avoid the zero-gradient problem when the center sits exactly on an
      // obstacle (Gaussian peak has zero gradient at d=0).
      const hw = n.width / 2;
      const hh = n.height / 2;
      let sumFx = 0;
      let sumFy = 0;
      const sampleX = [n.x, n.x - hw, n.x + hw, n.x - hw, n.x + hw];
      const sampleY = [n.y, n.y - hh, n.y - hh, n.y + hh, n.y + hh];
      for (let s = 0; s < 5; s++) {
        const { fx, fy } = sampleCostFieldForce(ctx.costField, sampleX[s], sampleY[s]);
        sumFx += fx;
        sumFy += fy;
      }
      n.vx += (sumFx / 5) * k;
      n.vy += (sumFy / 5) * k;
    }
  }
  force.initialize = (ns: any[]) => {
    nodes = ns as SimNode[];
  };
  return force as any;
}

export function runForceLayout(
  inputs: Array<
    LayoutItemInput & {
      anchorPx: { x: number; y: number };
      /** Optional previous output center (warm start) */
      prevCenter?: { x: number; y: number };
    }
  >,
  ctx: LayoutContext,
  params: LayoutParams
): { outputs: LayoutItemOutput[]; leaderLines: LeaderLine[] } {
  const nodes: SimNode[] = inputs.map((it) => {
    const targetX = it.anchorPx.x;
    const targetY = it.anchorPx.y - it.height / 2;
    const start = it.prevCenter ?? { x: targetX, y: targetY };
    return {
      id: it.id,
      x: start.x,
      y: start.y,
      vx: 0,
      vy: 0,
      width: it.width,
      height: it.height,
      padding: it.padding ?? 6,
      anchorX: targetX,
      anchorY: targetY,
    };
  });

  const sim = forceSimulation(nodes as any)
    .alpha(params.alpha)
    .alphaDecay(params.alphaDecay)
    .alphaMin(params.alphaMin)
    .force('x', forceX<SimNode>((d) => d.anchorX).strength(params.linkStrength))
    .force('y', forceY<SimNode>((d) => d.anchorY).strength(params.linkStrength))
    .force('collide', rectCollideForce(params.collideStrength))
    .force('field', fieldRepulsionForce(ctx, params))
    .force('bounds', boundingForce(ctx, params))
    .stop();

  const MAX_SIM_ITERATIONS = 2000;
  const CONVERGENCE_THRESHOLD = 0.01;
  
  for (let i = 0; i < MAX_SIM_ITERATIONS; i++) {
    const prevPositions = nodes.map(n => ({ x: n.x, y: n.y }));
    sim.tick();
    
    if (i >= params.iterations) {
      let totalMovement = 0;
      for (let j = 0; j < nodes.length; j++) {
        totalMovement += Math.abs(nodes[j].x - prevPositions[j].x);
        totalMovement += Math.abs(nodes[j].y - prevPositions[j].y);
      }
      const avgMovement = totalMovement / nodes.length;
      if (avgMovement < CONVERGENCE_THRESHOLD) {
        break;
      }
    }
  }

  // Post-process: deterministically resolve any remaining overlaps that the
  // decayed force simulation could not fully eliminate.
  // HARD CONSTRAINT: Never allow any overlaps between label/card/line/global
  const MAX_POST_PASSES = 50;
  for (let pass = 0; pass < MAX_POST_PASSES; pass++) {
    let anyOverlap = false;
    
    // 1. Resolve card/label vs card/label overlaps (HARD CONSTRAINT)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const overlapX = a.width / 2 + b.width / 2 + a.padding + b.padding - Math.abs(dx);
        const overlapY = a.height / 2 + b.height / 2 + a.padding + b.padding - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        anyOverlap = true;
        if (overlapX < overlapY) {
          const push = overlapX * 0.5;
          const sign = dx >= 0 ? 1 : -1;
          a.x -= sign * push;
          b.x += sign * push;
        } else {
          const push = overlapY * 0.5;
          const sign = dy >= 0 ? 1 : -1;
          a.y -= sign * push;
          b.y += sign * push;
        }
      }
    }
    
    // 2. Resolve card/label vs line/polygon segment overlaps (HARD CONSTRAINT)
    if (ctx.segments && ctx.segments.length > 0) {
      const segmentPadding = 12;
      for (const n of nodes) {
        const halfW = n.width / 2;
        const halfH = n.height / 2;
        for (const seg of ctx.segments) {
          const { overlaps, pushX, pushY } = rectSegmentOverlap(
            n.x, n.y, halfW, halfH, seg, segmentPadding
          );
          if (overlaps) {
            anyOverlap = true;
            // Use full overlap resolution
            n.x += pushX;
            n.y += pushY;
          }
        }
      }
    }

    // 3. Resolve card/label vs global item rect overlaps (HARD CONSTRAINT)
    if (ctx.globalRects && ctx.globalRects.length > 0) {
      const globalPadding = 8;
      for (const n of nodes) {
        const halfW = n.width / 2;
        const halfH = n.height / 2;
        for (const gr of ctx.globalRects) {
          const gCx = gr.x + gr.width / 2;
          const gCy = gr.y + gr.height / 2;
          const dx = n.x - gCx;
          const dy = n.y - gCy;
          const overlapX = halfW + gr.width / 2 + globalPadding - Math.abs(dx);
          const overlapY = halfH + gr.height / 2 + globalPadding - Math.abs(dy);
          if (overlapX > 0 && overlapY > 0) {
            anyOverlap = true;
            // Use full overlap resolution
            if (overlapX < overlapY) {
              n.x += dx >= 0 ? overlapX : -overlapX;
            } else {
              n.y += dy >= 0 ? overlapY : -overlapY;
            }
          }
        }
      }
    }

    if (!anyOverlap) break;
  }

  // Re-clamp to viewport bounds after post-processing.
  {
    const pad = params.boundsPadding;
    const vw = ctx.viewport.width;
    const vh = ctx.viewport.height;
    for (const n of nodes) {
      n.x = clamp(n.x, pad + n.width / 2, vw - pad - n.width / 2);
      n.y = clamp(n.y, pad + n.height / 2, vh - pad - n.height / 2);
    }
  }

  const outputs: LayoutItemOutput[] = inputs.map((it) => {
    const n = nodes.find((x) => x.id === it.id)!;
    const x = n.x - it.width / 2;   // n.x is center x → top-left x
    const y = n.y - it.height / 2;  // n.y is center y → top-left y
    return {
      ...it,
      anchorPx: it.anchorPx,
      x,
      y,
      cx: n.x,
      cy: n.y,
      centerLngLat: it.anchorLngLat,
    };
  });

  const leaderLines: LeaderLine[] = outputs.map((o) => ({
    id: o.id,
    x1: o.anchorPx.x,
    y1: o.anchorPx.y,
    x2: o.cx,
    y2: o.cy,
  }));

  return { outputs, leaderLines };
}

