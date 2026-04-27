import type { LayoutItemInput, LayoutItemOutput, LeaderLine, CostField, Segment, Rect } from './types';
import { sampleCostFieldForce } from '../layout/costField';

export type SimAnnealingParams = {
  initialTemp: number;
  finalTemp: number;
  coolingRate: number;
  iterationsPerTemp: number;
  maxStepSize: number;
  linkStrength: number;
  boundsPadding: number;
};

export type SimAnnealingContext = {
  viewport: { width: number; height: number };
  costField?: CostField;
  segments?: Segment[];
  globalRects?: Rect[];
};

type SimNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  padding: number;
  anchorX: number;
  anchorY: number;
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function calculateOverlapEnergy(a: SimNode, b: SimNode): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const overlapX = a.width / 2 + b.width / 2 + a.padding + b.padding - Math.abs(dx);
  const overlapY = a.height / 2 + b.height / 2 + a.padding + b.padding - Math.abs(dy);

  if (overlapX <= 0 || overlapY <= 0) return 0;

  return overlapX * overlapY * 10;
}

function calculateLinkEnergy(node: SimNode): number {
  const dx = node.x - node.anchorX;
  const dy = node.y - node.anchorY;
  return dx * dx + dy * dy;
}

function calculateFieldEnergy(node: SimNode, costField: CostField): number {
  let totalEnergy = 0;
  const hw = node.width / 2;
  const hh = node.height / 2;
  const sampleX = [node.x, node.x - hw, node.x + hw, node.x - hw, node.x + hw];
  const sampleY = [node.y, node.y - hh, node.y - hh, node.y + hh, node.y + hh];

  for (let s = 0; s < 5; s++) {
    const { fx, fy } = sampleCostFieldForce(costField, sampleX[s], sampleY[s]);
    totalEnergy += Math.sqrt(fx * fx + fy * fy);
  }

  return totalEnergy / 5;
}

function calculateSegmentOverlapEnergy(node: SimNode, segments: Segment[]): number {
  let energy = 0;
  const halfW = node.width / 2;
  const halfH = node.height / 2;
  const padding = 12;

  for (const seg of segments) {
    const segMinX = Math.min(seg.x1, seg.x2);
    const segMaxX = Math.max(seg.x1, seg.x2);
    const segMinY = Math.min(seg.y1, seg.y2);
    const segMaxY = Math.max(seg.y1, seg.y2);

    const nodeMinX = node.x - halfW - padding;
    const nodeMaxX = node.x + halfW + padding;
    const nodeMinY = node.y - halfH - padding;
    const nodeMaxY = node.y + halfH + padding;

    if (nodeMaxX < segMinX || nodeMinX > segMaxX || nodeMaxY < segMinY || nodeMinY > segMaxY) {
      continue;
    }

    const closestX = Math.max(segMinX, Math.min(node.x, segMaxX));
    const closestY = Math.max(segMinY, Math.min(node.y, segMaxY));

    const dx = node.x - closestX;
    const dy = node.y - closestY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < Math.min(halfW + padding, halfH + padding)) {
      energy += (Math.min(halfW + padding, halfH + padding) - dist) * 5;
    }
  }

  return energy;
}

function calculateGlobalRectOverlapEnergy(node: SimNode, globalRects: Rect[]): number {
  let energy = 0;
  const halfW = node.width / 2;
  const halfH = node.height / 2;
  const padding = 8;

  for (const gr of globalRects) {
    const gCx = gr.x + gr.width / 2;
    const gCy = gr.y + gr.height / 2;
    const dx = node.x - gCx;
    const dy = node.y - gCy;
    const overlapX = halfW + gr.width / 2 + padding - Math.abs(dx);
    const overlapY = halfH + gr.height / 2 + padding - Math.abs(dy);

    if (overlapX > 0 && overlapY > 0) {
      energy += overlapX * overlapY * 10;
    }
  }

  return energy;
}

function calculateTotalEnergy(nodes: SimNode[], costField?: CostField, segments?: Segment[], globalRects?: Rect[]): number {
  let energy = 0;

  for (const node of nodes) {
    energy += calculateLinkEnergy(node) * 0.1;
  }

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      energy += calculateOverlapEnergy(nodes[i], nodes[j]);
    }
  }

  if (costField) {
    for (const node of nodes) {
      energy += calculateFieldEnergy(node, costField) * 2;
    }
  }

  if (segments && segments.length > 0) {
    for (const node of nodes) {
      energy += calculateSegmentOverlapEnergy(node, segments) * 50;
    }
  }

  if (globalRects && globalRects.length > 0) {
    for (const node of nodes) {
      energy += calculateGlobalRectOverlapEnergy(node, globalRects);
    }
  }

  return energy;
}

function randomNeighbor(node: SimNode, stepSize: number, viewport: { width: number; height: number }, padding: number): SimNode {
  const angle = Math.random() * 2 * Math.PI;
  const dist = Math.random() * stepSize;

  const dx = Math.cos(angle) * dist;
  const dy = Math.sin(angle) * dist;

  const newX = clamp(node.x + dx, padding + node.width / 2, viewport.width - padding - node.width / 2);
  const newY = clamp(node.y + dy, padding + node.height / 2, viewport.height - padding - node.height / 2);

  return { ...node, x: newX, y: newY };
}

export function runSimulatedAnnealingLayout(
  inputs: Array<
    LayoutItemInput & {
      anchorPx: { x: number; y: number };
      prevCenter?: { x: number; y: number };
    }
  >,
  ctx: SimAnnealingContext,
  params: SimAnnealingParams
): { outputs: LayoutItemOutput[]; leaderLines: LeaderLine[] } {
  let nodes: SimNode[] = inputs.map((it) => {
    const targetX = it.anchorPx.x;
    const targetY = it.anchorPx.y - it.height / 2;
    const start = it.prevCenter ?? { x: targetX, y: targetY };
    return {
      id: it.id,
      x: start.x,
      y: start.y,
      width: it.width,
      height: it.height,
      padding: it.padding ?? 6,
      anchorX: targetX,
      anchorY: targetY,
    };
  });

  let currentEnergy = calculateTotalEnergy(nodes, ctx.costField, ctx.segments, ctx.globalRects);

  let temperature = params.initialTemp;
  let bestNodes = nodes.map(n => ({ ...n }));
  let bestEnergy = currentEnergy;

  while (temperature > params.finalTemp) {
    for (let iter = 0; iter < params.iterationsPerTemp; iter++) {
      const nodeIndex = Math.floor(Math.random() * nodes.length);
      const originalNode = { ...nodes[nodeIndex] };
      const neighborNode = randomNeighbor(originalNode, params.maxStepSize, ctx.viewport, params.boundsPadding);

      const testNodes = nodes.map((n, i) => i === nodeIndex ? neighborNode : { ...n });
      const neighborEnergy = calculateTotalEnergy(testNodes, ctx.costField, ctx.segments, ctx.globalRects);

      const deltaE = neighborEnergy - currentEnergy;

      if (deltaE < 0 || Math.random() < Math.exp(-deltaE / temperature)) {
        nodes = testNodes;
        currentEnergy = neighborEnergy;

        if (currentEnergy < bestEnergy) {
          bestNodes = nodes.map(n => ({ ...n }));
          bestEnergy = currentEnergy;
        }
      } else {
        nodes[nodeIndex] = originalNode;
      }
    }

    temperature *= params.coolingRate;
  }

  nodes = bestNodes;

  for (let pass = 0; pass < 50; pass++) {
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

    if (ctx.segments && ctx.segments.length > 0) {
      const segmentPadding = 12;
      for (const n of nodes) {
        const halfW = n.width / 2;
        const halfH = n.height / 2;
        for (const seg of ctx.segments) {
          const segMinX = Math.min(seg.x1, seg.x2);
          const segMaxX = Math.max(seg.x1, seg.x2);
          const segMinY = Math.min(seg.y1, seg.y2);
          const segMaxY = Math.max(seg.y1, seg.y2);

          const nodeMinX = n.x - halfW - segmentPadding;
          const nodeMaxX = n.x + halfW + segmentPadding;
          const nodeMinY = n.y - halfH - segmentPadding;
          const nodeMaxY = n.y + halfH + segmentPadding;

          if (nodeMaxX < segMinX || nodeMinX > segMaxX || nodeMaxY < segMinY || nodeMinY > segMaxY) {
            continue;
          }

          anyOverlap = true;
          const closestX = Math.max(segMinX, Math.min(n.x, segMaxX));
          const closestY = Math.max(segMinY, Math.min(n.y, segMaxY));
          const dx = n.x - closestX;
          const dy = n.y - closestY;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist > 0.001) {
            const pushDist = Math.min(halfW + segmentPadding, halfH + segmentPadding) - dist + 1;
            n.x += (dx / dist) * pushDist;
            n.y += (dy / dist) * pushDist;
          }
        }
      }
    }

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

  const pad = params.boundsPadding;
  const vw = ctx.viewport.width;
  const vh = ctx.viewport.height;
  for (const n of nodes) {
    n.x = clamp(n.x, pad + n.width / 2, vw - pad - n.width / 2);
    n.y = clamp(n.y, pad + n.height / 2, vh - pad - n.height / 2);
  }

  const outputs: LayoutItemOutput[] = inputs.map((it) => {
    const n = nodes.find((x) => x.id === it.id)!;
    const x = n.x - it.width / 2;
    const y = n.y - it.height / 2;
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

export const DEFAULT_SIM_ANNEALING: SimAnnealingParams = {
  initialTemp: 1000,
  finalTemp: 0.01,
  coolingRate: 0.99,
  iterationsPerTemp: 100,
  maxStepSize: 30,
  linkStrength: 0.1,
  boundsPadding: 10,
};
