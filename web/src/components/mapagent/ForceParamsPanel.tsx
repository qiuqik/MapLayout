'use client';
import { useState, useRef } from 'react';
import type { LayoutParams } from '@/app/agent/layout/forceLayout';

export type ForceParamsOverride = Pick<
  LayoutParams,
  'linkStrength' | 'lift' | 'collideStrength' | 'fieldStrength' | 'iterations' | 'leaderThreshold'
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
  { key: 'lift',            label: 'Lift (px)',               min: 0,    max: 100,  step: 1    },
  { key: 'collideStrength', label: 'Collide Strength',        min: 0.5,  max: 15,   step: 0.5  },
  { key: 'fieldStrength',   label: 'Field Strength',          min: 0,    max: 20,   step: 0.1  },
  { key: 'iterations',      label: 'Iterations',              min: 50,   max: 800,  step: 10   },
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
        style={{ width: '100%', accentColor: color, cursor: 'pointer' }}
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
    <div
      ref={panelRef}
      style={{
        position: 'absolute',
        ...posStyle,
        zIndex: 20,
        background: 'rgba(8, 8, 20, 0.88)',
        color: '#e2e8f0',
        borderRadius: 10,
        padding: '0 0 14px',
        width: 260,
        backdropFilter: 'blur(8px)',
        fontFamily: '"SF Mono", "Fira Code", monospace',
        fontSize: 11,
        boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
        pointerEvents: 'auto',
        maxHeight: 'calc(100vh - 60px)',
        overflowY: 'auto',
        userSelect: 'none',
      }}
    >
      {/* Drag handle */}
      <div
        onMouseDown={onMouseDown}
        style={{
          padding: '10px 14px 8px',
          cursor: dragging ? 'grabbing' : 'grab',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          marginBottom: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span style={{ opacity: 0.4, fontSize: 10, letterSpacing: 2 }}>⠿</span>
        <span style={{ fontWeight: 700, fontSize: 12, color: '#fff', letterSpacing: 0.3 }}>⚙ Layout Debug</span>
      </div>
      <div style={{ padding: '0 14px' }}>

      <div style={{ marginBottom: 7, fontSize: 9, color: '#7dd3fc', textTransform: 'uppercase', letterSpacing: 1.2, fontWeight: 700 }}>
        Force Simulation
      </div>
      {FORCE_SLIDERS.map(({ key, label, min, max, step }) => (
        <SliderRow
          key={key}
          label={label} min={min} max={max} step={step}
          value={forceParams[key]}
          color="#7dd3fc"
          onChange={v => onForceChange({ [key]: v })}
        />
      ))}

      <div style={{ margin: '12px 0 7px', fontSize: 9, color: '#86efac', textTransform: 'uppercase', letterSpacing: 1.2, fontWeight: 700 }}>
        Repulsion Field
      </div>
      {FIELD_SLIDERS.map(({ key, label, min, max, step }) => (
        <SliderRow
          key={key}
          label={label} min={min} max={max} step={step}
          value={fieldParams[key]}
          color="#86efac"
          onChange={v => onFieldChange({ [key]: v })}
        />
      ))}
      </div>{/* end padding wrapper */}
    </div>
  );
}
