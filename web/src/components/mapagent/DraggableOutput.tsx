'use client';

import React, { useCallback, useRef, useState, useEffect } from 'react';
import { MapRef } from 'react-map-gl/mapbox';
import type { LayoutItemOutput} from '@/app/agent/layout/types';

interface DraggableOutputProps {
  outputPosition: LayoutItemOutput;
  enabled: boolean;
  mapRef: React.RefObject<MapRef>;
  onPositionChange: (id: string, lng: number, lat: number, position?: { x: number; y: number }) => void;
  overridePosition?: { lng: number; lat: number } | { x: number; y: number };
  selectable?: boolean;
  onSelect?: (output: LayoutItemOutput) => void;
}

const DraggableOutput: React.FC<DraggableOutputProps> = ({
  outputPosition,
  enabled,
  mapRef,
  onPositionChange,
  overridePosition,
  selectable = false,
  onSelect,
}) => {
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: outputPosition.x, y: outputPosition.y });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; elemX: number; elemY: number } | null>(null);
  const canSelect = selectable && Boolean(onSelect);
  
  const applyOverride = () => {
    const raw = mapRef.current as any;
    const map = raw?.getMap ? raw.getMap() : raw;
    if (map) {
      if ('lng' in overridePosition && 'lat' in overridePosition) {
        const px = map.project([overridePosition.lng, overridePosition.lat]);
        const left = px.x - outputPosition.width / 2;
        const top = px.y - outputPosition.height / 2;
        setPosition({ x: left, y: top });
      } else if ('x' in overridePosition && 'y' in overridePosition) {
        setPosition({ x: overridePosition.x, y: overridePosition.y });
      }
    } else {
      setTimeout(applyOverride, 50);
    }
  };
  
  useEffect(() => {
    if (!enabled) {
      setPosition({ x: outputPosition.x, y: outputPosition.y });
      return;
    }
    if (!overridePosition) return;
    applyOverride();
  }, [overridePosition, enabled, outputPosition]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!enabled) {
      if (canSelect) {
        e.preventDefault();
        e.stopPropagation();
        onSelect?.(outputPosition);
      }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    onSelect?.(outputPosition);

    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      elemX: position.x,
      elemY: position.y,
    };

    setIsDragging(true);
  }, [canSelect, enabled, onSelect, outputPosition, position.x, position.y]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !dragStartRef.current || !enabled) return;

    const dx = e.clientX - dragStartRef.current.mouseX;
    const dy = e.clientY - dragStartRef.current.mouseY;

    const newX = dragStartRef.current.elemX + dx;
    const newY = dragStartRef.current.elemY + dy;

    setPosition({ x: newX, y: newY });
  }, [isDragging, enabled]);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (!isDragging || !dragStartRef.current || !mapRef.current) return;

    const raw = mapRef.current as any;
    const map = raw?.getMap ? raw.getMap() : raw;
    if (!map) return;

    const dx = e.clientX - dragStartRef.current.mouseX;
    const dy = e.clientY - dragStartRef.current.mouseY;

    const finalX = dragStartRef.current.elemX + dx;
    const finalY = dragStartRef.current.elemY + dy;

    const viewportX = finalX + outputPosition.width / 2;
    const viewportY = finalY + outputPosition.height / 2;

    const moved = Math.abs(dx) + Math.abs(dy) > 2;
    if (moved) {
      const lngLat = map.unproject([viewportX, viewportY]);
      onPositionChange(outputPosition.id, lngLat.lng, lngLat.lat, { x: finalX, y: finalY });
    }

    setIsDragging(false);
    dragStartRef.current = null;
  }, [isDragging, mapRef, outputPosition.id, outputPosition.width, outputPosition.height, onPositionChange]);

  useEffect(() => {
    if (enabled) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [enabled, handleMouseMove, handleMouseUp]);

  const usesScaleVariable = outputPosition.html.includes('--map-label-scale');
  const visualScale = usesScaleVariable ? 1 : outputPosition.scale ?? 1;
  const positionStyle: React.CSSProperties & Record<string, string | number> = {
    position: 'absolute',
    left: `${position.x}px`,
    top: `${position.y}px`,
    pointerEvents: enabled || canSelect ? 'auto' : 'none',
    cursor: enabled ? (isDragging ? 'grabbing' : 'grab') : canSelect ? 'pointer' : 'default',
    zIndex: isDragging ? 1000 : 5,
    transform: `scale(${visualScale})`,
    transformOrigin: 'center center',
    '--map-label-scale': outputPosition.scale ?? 1,
  };

  return (
    <div
      className="map-feature-click-target"
      data-map-feature-kind="layout_label"
      style={positionStyle}
      onMouseDown={handleMouseDown}
      dangerouslySetInnerHTML={{ __html: outputPosition.html }}
    />
  );
};

export default DraggableOutput;
