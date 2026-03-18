import type { LayoutItemOutput } from './types';

type NodeLike = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  padding: number;
};

function rectsOverlap(a: NodeLike, b: NodeLike) {
  const ax1 = a.x - a.width / 2 - a.padding;
  const ax2 = a.x + a.width / 2 + a.padding;
  const ay1 = a.y - a.height / 2 - a.padding;
  const ay2 = a.y + a.height / 2 + a.padding;

  const bx1 = b.x - b.width / 2 - b.padding;
  const bx2 = b.x + b.width / 2 + b.padding;
  const by1 = b.y - b.height / 2 - b.padding;
  const by2 = b.y + b.height / 2 + b.padding;

  return ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1;
}

/**
 * Simple rectangle collision resolution force (O(n^2)).
 * Works well for dozens of labels/cards.
 */
export function rectCollideForce(strength = 1) {
  let nodes: NodeLike[] = [];

  function force(alpha: number) {
    const k = strength * alpha;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        if (!rectsOverlap(a, b)) continue;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const absX = Math.abs(dx) || 1e-6;
        const absY = Math.abs(dy) || 1e-6;

        const overlapX =
          a.width / 2 + b.width / 2 + a.padding + b.padding - absX;
        const overlapY =
          a.height / 2 + b.height / 2 + a.padding + b.padding - absY;

        if (overlapX <= 0 || overlapY <= 0) continue;

        // Push along the axis with smaller overlap.
        if (overlapX < overlapY) {
          const sx = (dx / absX) * overlapX * 0.5 * k;
          a.vx -= sx;
          b.vx += sx;
        } else {
          const sy = (dy / absY) * overlapY * 0.5 * k;
          a.vy -= sy;
          b.vy += sy;
        }
      }
    }
  }

  force.initialize = (ns: any[]) => {
    nodes = ns as NodeLike[];
  };

  return force as any;
}

export function toNodeLike(items: LayoutItemOutput[]): NodeLike[] {
  return items.map((it) => ({
    id: it.id,
    x: it.cx,
    y: it.cy,
    vx: 0,
    vy: 0,
    width: it.width,
    height: it.height,
    padding: it.padding ?? 6,
  }));
}

