'use client';

import React, { useCallback, useRef, useState, useEffect } from 'react';
import { MapRef } from 'react-map-gl/mapbox';
import type { LayoutItemOutput} from '@/app/agent/layout/types';

interface DraggableOutputProps {
  outputPosition: LayoutItemOutput;
  enabled: boolean;
  mapRef: React.RefObject<MapRef>;
  onPositionChange: (id: string, lng: number, lat: number) => void;
  overridePosition?: { lng: number; lat: number } | { x: number; y: number };
}

const DraggableOutput: React.FC<DraggableOutputProps> = ({
  outputPosition,
  enabled,
  mapRef,
  onPositionChange,
  overridePosition,
}) => {
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: outputPosition.x, y: outputPosition.y });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; elemX: number; elemY: number } | null>(null);
  
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
    if (!enabled) return;
    e.preventDefault();
    e.stopPropagation();

    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      elemX: position.x,
      elemY: position.y,
    };

    setIsDragging(true);
  }, [enabled, position.x, position.y]);

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

    const lngLat = map.unproject([viewportX, viewportY]);
    onPositionChange(outputPosition.id, lngLat.lng, lngLat.lat);

    setIsDragging(false);
    dragStartRef.current = null;
  }, [isDragging, mapRef, outputPosition.id, onPositionChange]);

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

  const positionStyle: React.CSSProperties = {
    position: 'absolute',
    left: `${position.x}px`,
    top: `${position.y}px`,
    pointerEvents: enabled ? 'auto' : 'none',
    cursor: enabled ? (isDragging ? 'grabbing' : 'grab') : 'default',
    zIndex: isDragging ? 1000 : 5,
  };

  return (
    <div
      style={positionStyle}
      onMouseDown={handleMouseDown}
      dangerouslySetInnerHTML={{ __html: outputPosition.html }}
    />
  );
};

export default DraggableOutput;