import { forceSimulation, forceX, forceY } from 'd3-force';
import type { CostField } from './costField';
import { sampleCostFieldForce } from './costField';
import type { LayoutItemInput, LayoutItemOutput, LeaderLine } from './types';
import { rectCollideForce } from './rectCollide';

export type LayoutParams = {
  /** Pull label/card center towards anchorPx + (0, -lift) */
  linkStrength: number;
  /** Lift target above anchor (px) */
  lift: number;
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
    // n.y is the vertical CENTER of the element.
    // We want the bottom edge to sit `lift` px above the anchor,
    // so center = anchorPx.y - lift - height/2.
    const targetY = it.anchorPx.y - params.lift - it.height / 2;
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

  for (let i = 0; i < params.iterations; i++) sim.tick();

  // Post-process: deterministically resolve any remaining overlaps that the
  // decayed force simulation could not fully eliminate.
  const MAX_POST_PASSES = 12;
  for (let pass = 0; pass < MAX_POST_PASSES; pass++) {
    let anyOverlap = false;
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
    };
  });

  const leaderLines: LeaderLine[] = outputs.map((o) => ({
    id: o.id,
    x1: o.anchorPx.x,
    y1: o.anchorPx.y,
    x2: o.x,
    y2: o.y,
  }));

  return { outputs, leaderLines };
}

