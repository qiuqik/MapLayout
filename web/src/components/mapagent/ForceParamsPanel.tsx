'use client';
import { useState, useRef } from 'react';
import type { LayoutParams } from '@/app/agent/layout/forceLayout';

export type ForceParamsOverride = Pick<
  LayoutParams,
  'linkStrength' | 'collideStrength' | 'fieldStrength' | 'iterations' | 'leaderThreshold'
>;

export type FieldParamsOverride = {
  sigma: number;
  strength: number;
  obstaclePadding: number;
  cellSize: number;
};

interface Props {
  forceParams: ForceParamsOverride;
  fieldParams: FieldParamsOverride;
  onForceChange: (p: Partial<ForceParamsOverride>) => void;
  onFieldChange: (p: Partial<FieldParamsOverride>) => void;
}

const FORCE_SLIDERS: Array<{
  key: keyof ForceParamsOverride;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: 'linkStrength',    label: 'Link Strength',          min: 0.01, max: 1,    step: 0.01 },
  { key: 'collideStrength', label: 'Collide Strength',        min: 0.5,  max: 15,   step: 0.5  },
  { key: 'fieldStrength',   label: 'Field Strength',          min: 0,    max: 20,   step: 0.1  },
  { key: 'iterations',      label: 'Iterations',              min: 0,    max: 5000,  step: 10   },
  { key: 'leaderThreshold', label: 'Leader Threshold (px)',   min: 0,    max: 100,  step: 1    },
];

const FIELD_SLIDERS: Array<{
  key: keyof FieldParamsOverride;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: 'sigma',           label: 'σ Gaussian (px)',         min: 5,    max: 150,  step: 1   },
  { key: 'strength',        label: 'Field Strength',          min: 100,  max: 8000, step: 100 },
  { key: 'obstaclePadding', label: 'Obstacle Padding (px)',   min: 0,    max: 50,   step: 1   },
  { key: 'cellSize',        label: 'Cell Size (px)',          min: 8,    max: 64,   step: 4   },
];

function SliderRow({
  label, min, max, step, value, color, onChange,
}: {
  label: string; min: number; max: number; step: number;
  value: number; color: string; onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ fontSize: 10, opacity: 0.85 }}>{label}</span>
        <span style={{ fontSize: 10, color, fontWeight: 700 }}>{value}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: color, cursor: 'pointer'}}
      />
    </div>
  );
}

export default function ForceParamsPanel({ forceParams, fieldParams, onForceChange, onFieldChange }: Props) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const panel = panelRef.current;
    if (!panel) return;
    const originX = pos?.x ?? panel.offsetLeft;
    const originY = pos?.y ?? panel.offsetTop;
    drag.current = { startX: e.clientX, startY: e.clientY, originX, originY };
    setDragging(true);

    const onMouseMove = (e: MouseEvent) => {
      if (!drag.current) return;
      setPos({
        x: drag.current.originX + e.clientX - drag.current.startX,
        y: drag.current.originY + e.clientY - drag.current.startY,
      });
    };
    const onMouseUp = () => {
      drag.current = null;
      setDragging(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const posStyle: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y, right: 'auto' }
    : { top: 12, right: 12 };

return (
  <div className="w-full bg-white border border-gray-200 rounded-lg shadow-sm font-sans text-[11px] overflow-hidden">
    <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 flex items-center gap-1.5">
      <span className="font-semibold text-gray-800 text-sm">⚙ Layout Debug</span>
    </div>
    <div className="p-2.5">
      <div className="mb-1.5 text-[10px] text-sky-800 uppercase tracking-wider font-semibold">Force Simulation</div>
      {FORCE_SLIDERS.map(({ key, label, min, max, step }) => (
        <SliderRow
          key={key} label={label} min={min} max={max} step={step}
          value={forceParams[key]} color="oklch(44.3% 0.11 240.79)"
          onChange={v => onForceChange({ [key]: v })}
        />
      ))}

      <div className="mt-2.5 mb-1.5 text-[10px] text-teal-700 uppercase tracking-wider font-semibold">Repulsion Field</div>
      {FIELD_SLIDERS.map(({ key, label, min, max, step }) => (
        <SliderRow
          key={key} label={label} min={min} max={max} step={step}
          value={fieldParams[key]} color="oklch(51.1% 0.096 186.391)"
          onChange={v => onFieldChange({ [key]: v })}
        />
      ))}
    </div>
  </div>
);


  
}
