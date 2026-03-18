'use client';
import { useEffect, useRef } from 'react';
import type { CostField } from '@/app/agent/layout/costField';

interface Props {
  costField: CostField | null;
}

/**
 * Renders the repulsion cost field as a red-blue heat map over the map.
 * Red = high cost (near obstacles, do not place).
 * Blue = low cost (safe to place).
 */
export default function DebugOverlay({ costField }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!costField) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const { cols, rows, cost, params } = costField;
    const { cellSize, width, height } = params;

    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = cost[r * cols + c];
        if (v < 0.01) continue; // skip near-zero cells for performance

        // v=0 → blue (30, 30, 255), v=1 → red (255, 30, 30)
        const red = Math.round(30 + v * 225);
        const blue = Math.round(255 - v * 225);
        const alpha = (v * 0.62).toFixed(2);

        ctx.fillStyle = `rgba(${red},30,${blue},${alpha})`;
        ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
      }
    }
  }, [costField]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 10,
      }}
    />
  );
}
