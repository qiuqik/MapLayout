import type { LayoutItemInput, LayoutItemOutput, LeaderLine, CostField, Segment, Rect } from './types';
import { sampleCostFieldForce } from '../layout/costField';
import { forceSimulation, forceX, forceY } from 'd3-force';
import { rectCollideForce } from '../layout/rectCollide';
import type { Segment as LayoutSegment } from '../layout/obstacles';

export type VoronoiParams = {
  maxIterations: number;
  collisionIterations: number;
  segmentPadding: number;
  globalPadding: number;
  boundsPadding: number;
  weightScale: number;
  anchorStrength: number;
};

export type VoronoiForceParams = {
  linkStrength: number;
  collideStrength: number;
  fieldStrength: number;
  alpha: number;
  alphaDecay: number;
  alphaMin: number;
  iterations: number;
};

export type VoronoiContext = {
  viewport: { width: number; height: number };
  costField?: CostField;
  segments?: Segment[];
  globalRects?: Rect[];
};

type VoronoiNode = {
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
  weight: number;
};

type Cell = {
  node: VoronoiNode;
  centroidX: number;
  centroidY: number;
  vertices: { x: number; y: number }[];
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function pointToSegmentDistance(px: number, py: number, seg: Segment): number {
  const abx = seg.x2 - seg.x1;
  const aby = seg.y2 - seg.y1;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) {
    const dx = px - seg.x1, dy = py - seg.y1;
    return Math.sqrt(dx * dx + dy * dy);
  }
  const t = Math.max(0, Math.min(1, ((px - seg.x1) * abx + (py - seg.y1) * aby) / len2));
  const cx = seg.x1 + t * abx;
  const cy = seg.y1 + t * aby;
  return Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
}

function lineSegmentIntersection(
  cx: number, cy: number, halfW: number, halfH: number,
  seg: Segment, padding: number
): boolean {
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
    return false;
  }

  return true;
}

function getClosestPointOnSegment(
  px: number, py: number,
  x1: number, y1: number, x2: number, y2: number
): { x: number; y: number; nx: number; ny: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: x1, y: y1, nx: 0, ny: 0 };

  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;

  const dirLen = Math.sqrt(len2);
  let nx = -dy / dirLen;
  let ny = dx / dirLen;

  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const toPointX = px - midX;
  const toPointY = py - midY;
  if (toPointX * nx + toPointY * ny < 0) {
    nx = -nx;
    ny = -ny;
  }

  return { x: closestX, y: closestY, nx, ny };
}

function buildPowerDiagram(
  nodes: VoronoiNode[],
  width: number,
  height: number
): Cell[] {
  const cells: Cell[] = [];
  const numNodes = nodes.length;

  if (numNodes === 0) return cells;

  const gridSize = 20;
  const gridWidth = Math.ceil(width / gridSize);
  const gridHeight = Math.ceil(height / gridSize);

  for (const node of nodes) {
    const boundingBox = {
      minX: node.x - node.width - node.padding,
      maxX: node.x + node.width + node.padding,
      minY: node.y - node.height - node.padding,
      maxY: node.y + node.height + node.padding,
    };

    let sumX = 0, sumY = 0, count = 0;
    const vertices: { x: number; y: number }[] = [];

    for (let gy = 0; gy < gridHeight; gy++) {
      for (let gx = 0; gx < gridWidth; gx++) {
        const px = (gx + 0.5) * gridSize;
        const py = (gy + 0.5) * gridSize;

        let closestNode: VoronoiNode | null = null;
        let minPower = Infinity;

        for (const other of nodes) {
          const dx = px - other.x;
          const dy = py - other.y;
          const dist2 = dx * dx + dy * dy;
          const power = dist2 - other.weight * other.weight;

          if (power < minPower) {
            minPower = power;
            closestNode = other;
          }
        }

        if (closestNode === node) {
          sumX += px;
          sumY += py;
          count++;

          const isEdge = gx === 0 || gx === gridWidth - 1 || gy === 0 || gy === gridHeight - 1;
          if (isEdge) {
            vertices.push({ x: px, y: py });
          }
        }
      }
    }

    if (count > 0) {
      const centroidX = sumX / count;
      const centroidY = sumY / count;
      cells.push({ node, centroidX, centroidY, vertices });
    } else {
      cells.push({
        node,
        centroidX: node.x,
        centroidY: node.y,
        vertices: [],
      });
    }
  }

  return cells;
}

function findInitialPosition(cell: Cell, anchorX: number, anchorY: number): { x: number; y: number } {
  let bestX = cell.centroidX;
  let bestY = cell.centroidY;
  let bestDist = Math.sqrt((bestX - anchorX) ** 2 + (bestY - anchorY) ** 2);

  if (cell.vertices.length > 0) {
    for (const v of cell.vertices) {
      const dist = Math.sqrt((v.x - anchorX) ** 2 + (v.y - anchorY) ** 2);
      if (dist < bestDist) {
        bestDist = dist;
        bestX = v.x;
        bestY = v.y;
      }
    }
  }

  return { x: bestX, y: bestY };
}

function resolveRectOverlap(
  a: VoronoiNode,
  b: VoronoiNode
): { dx: number; dy: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const overlapX = a.width / 2 + b.width / 2 + a.padding + b.padding - Math.abs(dx);
  const overlapY = a.height / 2 + b.height / 2 + a.padding + b.padding - Math.abs(dy);

  if (overlapX <= 0 || overlapY <= 0) return { dx: 0, dy: 0 };

  if (overlapX < overlapY) {
    const push = overlapX * 0.5;
    const sign = dx >= 0 ? 1 : -1;
    return { dx: sign * push, dy: 0 };
  } else {
    const push = overlapY * 0.5;
    const sign = dy >= 0 ? 1 : -1;
    return { dx: 0, dy: sign * push };
  }
}

function resolveSegmentOverlap(
  node: VoronoiNode,
  seg: Segment,
  padding: number
): { dx: number; dy: number } {
  const halfW = node.width / 2;
  const halfH = node.height / 2;

  const segMinX = Math.min(seg.x1, seg.x2);
  const segMaxX = Math.max(seg.x1, seg.x2);
  const segMinY = Math.min(seg.y1, seg.y2);
  const segMaxY = Math.max(seg.y1, seg.y2);

  const nodeMinX = node.x - halfW - padding;
  const nodeMaxX = node.x + halfW + padding;
  const nodeMinY = node.y - halfH - padding;
  const nodeMaxY = node.y + halfH + padding;

  if (nodeMaxX < segMinX || nodeMinX > segMaxX || nodeMaxY < segMinY || nodeMinY > segMaxY) {
    return { dx: 0, dy: 0 };
  }

  const closest = getClosestPointOnSegment(node.x, node.y, seg.x1, seg.y1, seg.x2, seg.y2);
  const dist = Math.sqrt((node.x - closest.x) ** 2 + (node.y - closest.y) ** 2);

  if (dist < 0.001) {
    const pushDist = Math.min(halfW + padding, halfH + padding) + 1;
    return { dx: closest.nx * pushDist, dy: closest.ny * pushDist };
  }

  const pushDist = Math.min(halfW + padding, halfH + padding) - dist + 1;
  return { dx: closest.nx * pushDist, dy: closest.ny * pushDist };
}

function resolveGlobalRectOverlap(
  node: VoronoiNode,
  rect: Rect,
  padding: number
): { dx: number; dy: number } {
  const halfW = node.width / 2;
  const halfH = node.height / 2;
  const gCx = rect.x + rect.width / 2;
  const gCy = rect.y + rect.height / 2;

  const dx = node.x - gCx;
  const dy = node.y - gCy;
  const overlapX = halfW + rect.width / 2 + padding - Math.abs(dx);
  const overlapY = halfH + rect.height / 2 + padding - Math.abs(dy);

  if (overlapX <= 0 || overlapY <= 0) return { dx: 0, dy: 0 };

  if (overlapX < overlapY) {
    return { dx: dx >= 0 ? overlapX : -overlapX, dy: 0 };
  } else {
    return { dx: 0, dy: dy >= 0 ? overlapY : -overlapY };
  }
}

function applyFieldForce(node: VoronoiNode, costField: CostField): { dx: number; dy: number } {
  let sumFx = 0, sumFy = 0;
  const hw = node.width / 2;
  const hh = node.height / 2;
  const sampleX = [node.x, node.x - hw, node.x + hw, node.x - hw, node.x + hw];
  const sampleY = [node.y, node.y - hh, node.y - hh, node.y + hh, node.y + hh];

  for (let s = 0; s < 5; s++) {
    const { fx, fy } = sampleCostFieldForce(costField, sampleX[s], sampleY[s]);
    sumFx += fx;
    sumFy += fy;
  }

  return { dx: sumFx / 5, dy: sumFy / 5 };
}

function applyAnchorForce(node: VoronoiNode, strength: number): { dx: number; dy: number } {
  const dx = node.anchorX - node.x;
  const dy = node.anchorY - node.y;
  return { dx: dx * strength, dy: dy * strength };
}

function limitDisplacement(dx: number, dy: number, maxDist: number): { dx: number; dy: number } {
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > maxDist && dist > 0) {
    return { dx: (dx / dist) * maxDist, dy: (dy / dist) * maxDist };
  }
  return { dx, dy };
}

export function runWeightedVoronoiLayout(
  inputs: Array<
    LayoutItemInput & {
      anchorPx: { x: number; y: number };
      prevCenter?: { x: number; y: number };
    }
  >,
  ctx: VoronoiContext,
  params: VoronoiParams
): { outputs: LayoutItemOutput[]; leaderLines: LeaderLine[] } {
  let nodes: VoronoiNode[] = inputs.map((it) => {
    const targetX = it.anchorPx.x;
    const targetY = it.anchorPx.y - it.height / 2;
    const start = it.prevCenter ?? { x: targetX, y: targetY };
    const area = it.width * it.height;
    const weight = Math.sqrt(area) * params.weightScale;

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
      weight,
    };
  });

  const cells = buildPowerDiagram(nodes, ctx.viewport.width, ctx.viewport.height);

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell.vertices.length > 0) {
      const pos = findInitialPosition(cell, nodes[i].anchorX, nodes[i].anchorY);
      nodes[i].x = clamp(pos.x, params.boundsPadding + nodes[i].width / 2, ctx.viewport.width - params.boundsPadding - nodes[i].width / 2);
      nodes[i].y = clamp(pos.y, params.boundsPadding + nodes[i].height / 2, ctx.viewport.height - params.boundsPadding - nodes[i].height / 2);
    }
  }

  for (let iter = 0; iter < params.collisionIterations; iter++) {
    let anyMovement = false;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const { dx, dy } = resolveRectOverlap(a, b);

        if (dx !== 0 || dy !== 0) {
          anyMovement = true;
          const limitedA = limitDisplacement(-dx, -dy, 20);
          const limitedB = limitDisplacement(dx, dy, 20);
          a.x += limitedA.dx;
          a.y += limitedA.dy;
          b.x += limitedB.dx;
          b.y += limitedB.dy;
        }
      }
    }

    if (ctx.segments && ctx.segments.length > 0) {
      for (const n of nodes) {
        for (const seg of ctx.segments) {
          if (lineSegmentIntersection(n.x, n.y, n.width / 2, n.height / 2, seg, params.segmentPadding)) {
            const { dx, dy } = resolveSegmentOverlap(n, seg, params.segmentPadding);
            if (dx !== 0 || dy !== 0) {
              anyMovement = true;
              const limited = limitDisplacement(dx, dy, 20);
              n.x += limited.dx;
              n.y += limited.dy;
            }
          }
        }
      }
    }

    if (ctx.globalRects && ctx.globalRects.length > 0) {
      for (const n of nodes) {
        for (const rect of ctx.globalRects) {
          const { dx, dy } = resolveGlobalRectOverlap(n, rect, params.globalPadding);
          if (dx !== 0 || dy !== 0) {
            anyMovement = true;
            const limited = limitDisplacement(dx, dy, 20);
            n.x += limited.dx;
            n.y += limited.dy;
          }
        }
      }
    }

    if (ctx.costField) {
      for (const n of nodes) {
        const { dx, dy } = applyFieldForce(n, ctx.costField);
        if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
          anyMovement = true;
          const limited = limitDisplacement(dx * 2, dy * 2, 10);
          n.x += limited.dx;
          n.y += limited.dy;
        }
      }
    }

    for (const n of nodes) {
      const { dx, dy } = applyAnchorForce(n, params.anchorStrength);
      if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
        anyMovement = true;
        n.x += dx;
        n.y += dy;
      }
    }

    if (!anyMovement) break;
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

function voronoiBoundingForce(ctx: VoronoiContext, params: VoronoiParams) {
  let nodes: VoronoiNode[] = [];
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
      n.vx = (tx - n.x) * alpha * 2;
      n.vy = (ty - n.y) * alpha * 2;
    }
  }
  force.initialize = (ns: any[]) => {
    nodes = ns as VoronoiNode[];
  };
  return force as any;
}

function voronoiFieldRepulsionForce(ctx: VoronoiContext, fieldStrength: number) {
  let nodes: VoronoiNode[] = [];
  function force(alpha: number) {
    if (!ctx.costField) return;
    const k = alpha * fieldStrength;
    for (const n of nodes) {
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
    nodes = ns as VoronoiNode[];
  };
  return force as any;
}

export function runVoronoiForceLayout(
  inputs: Array<
    LayoutItemInput & {
      anchorPx: { x: number; y: number };
      prevCenter?: { x: number; y: number };
    }
  >,
  ctx: VoronoiContext,
  voronoiParams: VoronoiParams,
  forceParams: VoronoiForceParams
): { outputs: LayoutItemOutput[]; leaderLines: LeaderLine[] } {
  let nodes: VoronoiNode[] = inputs.map((it) => {
    const targetX = it.anchorPx.x;
    const targetY = it.anchorPx.y - it.height / 2;
    const start = it.prevCenter ?? { x: targetX, y: targetY };
    const area = it.width * it.height;
    const weight = Math.sqrt(area) * voronoiParams.weightScale;

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
      weight,
    };
  });

  const cells = buildPowerDiagram(nodes, ctx.viewport.width, ctx.viewport.height);

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell.vertices.length > 0) {
      const pos = findInitialPosition(cell, nodes[i].anchorX, nodes[i].anchorY);
      nodes[i].x = clamp(pos.x, voronoiParams.boundsPadding + nodes[i].width / 2, ctx.viewport.width - voronoiParams.boundsPadding - nodes[i].width / 2);
      nodes[i].y = clamp(pos.y, voronoiParams.boundsPadding + nodes[i].height / 2, ctx.viewport.height - voronoiParams.boundsPadding - nodes[i].height / 2);
    }
  }

  const linkStrength = forceParams.linkStrength;
  const collideStrength = forceParams.collideStrength;
  const fieldStrength = forceParams.fieldStrength;
  const iterations = forceParams.iterations;
  const alpha = forceParams.alpha;
  const alphaDecay = forceParams.alphaDecay;
  const alphaMin = forceParams.alphaMin;

  const sim = forceSimulation(nodes as any)
    .alpha(alpha)
    .alphaDecay(alphaDecay)
    .alphaMin(alphaMin)
    .force('x', forceX<VoronoiNode>((d) => d.anchorX).strength(linkStrength))
    .force('y', forceY<VoronoiNode>((d) => d.anchorY).strength(linkStrength))
    .force('collide', rectCollideForce(collideStrength))
    .force('field', voronoiFieldRepulsionForce(ctx, fieldStrength))
    .force('bounds', voronoiBoundingForce(ctx, voronoiParams))
    .stop();

  const MAX_SIM_ITERATIONS = 2000;
  const CONVERGENCE_THRESHOLD = 0.01;

  for (let i = 0; i < MAX_SIM_ITERATIONS; i++) {
    const prevPositions = nodes.map(n => ({ x: n.x, y: n.y }));
    sim.tick();

    if (i >= iterations) {
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
      const segmentPadding = voronoiParams.segmentPadding;
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
      const globalPadding = voronoiParams.globalPadding;
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

  {
    const pad = voronoiParams.boundsPadding;
    const vw = ctx.viewport.width;
    const vh = ctx.viewport.height;
    for (const n of nodes) {
      n.x = clamp(n.x, pad + n.width / 2, vw - pad - n.width / 2);
      n.y = clamp(n.y, pad + n.height / 2, vh - pad - n.height / 2);
    }
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

export const DEFAULT_VORONOI: VoronoiParams = {
  maxIterations: 100,
  collisionIterations: 100,
  segmentPadding: 12,
  globalPadding: 8,
  boundsPadding: 10,
  weightScale: 0.25,
  anchorStrength: 0.5,
};

export const DEFAULT_VORONOI_FORCE: VoronoiForceParams = {
  linkStrength: 5,
  collideStrength: 3.0,
  fieldStrength: 0.5,
  alpha: 0.25,
  alphaDecay: 0.025,
  alphaMin: 0.001,
  iterations: 4000,
};
