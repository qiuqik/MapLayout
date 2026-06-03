'use client';

import { Marker } from 'react-map-gl/mapbox';
import { API_BASE_URL } from '@/lib/api';

interface PointRendererProps {
  points: any[];
  pointStyles: any[];
  globalProps?: any;
  selectable?: boolean;
  onFeatureSelect?: (feature: any, kind: 'point') => void;
}

const resolvePointSize = (pointStyle: any): { width: number; height: number } => {
  const rawSize = pointStyle?.style?.size ?? pointStyle?.size;
  if (Array.isArray(rawSize)) {
    const width = Number(rawSize[0]);
    const height = Number(rawSize[1] ?? rawSize[0]);
    return {
      width: Number.isFinite(width) && width > 0 ? width : 28,
      height: Number.isFinite(height) && height > 0 ? height : 28,
    };
  }
  const size = Number(rawSize);
  const safeSize = Number.isFinite(size) && size > 0 ? size : 28;
  return { width: safeSize, height: safeSize };
};

const PointRenderer: React.FC<PointRendererProps> = ({ points, pointStyles, selectable = false, onFeatureSelect }) => {
  const renderPointIcon = (pointStyle: any, feature: any) => {
    const rawIconSrc = pointStyle.url;
    const iconSrc = rawIconSrc
      ? String(rawIconSrc).startsWith('http')
        ? rawIconSrc
        : `${API_BASE_URL}${rawIconSrc}`
      : '';
    const visualStyle = pointStyle.style && typeof pointStyle.style === 'object' ? pointStyle.style : {};
    const { width, height } = resolvePointSize(pointStyle);
    const fallback = pointStyle.fallback && typeof pointStyle.fallback === 'object' ? pointStyle.fallback : {};
    const fallbackColor = visualStyle.color || pointStyle.color || fallback.color || '#E4572E';

    if (iconSrc) {
      return (
        <img
          src={iconSrc}
          alt={feature.properties?.name || pointStyle['icon描述'] || 'POI'}
          style={{
            width,
            height,
            objectFit: 'contain',
            display: 'block',
            filter: fallback.shadow ? `drop-shadow(${fallback.shadow})` : 'drop-shadow(0 1px 2px rgba(0,0,0,0.25))',
          }}
        />
      );
    }

    return (
      <span
        style={{
          width: Math.max(12, width * 0.58),
          height: Math.max(12, height * 0.58),
          borderRadius: '999px',
          background: fallbackColor,
          border: `2px solid ${fallback.borderColor || '#fff'}`,
          boxShadow: fallback.shadow || '0 1px 4px rgba(0,0,0,0.28)',
          display: 'block',
        }}
      />
    );
  };

  return (
    <>
      {points.map((feature: any) => {
        const pointStyle = pointStyles.find(
          (p: any) => p.visual_id === feature.properties?.visual_id
        );
        if (!pointStyle) return null;

        const [lng, lat] = feature.geometry.coordinates;
        const { width, height } = resolvePointSize(pointStyle);
        
        return (
          <Marker
            key={feature.properties?.name || feature.properties?.visual_id}
            longitude={lng}
            latitude={lat}
            anchor={pointStyle.anchor || 'bottom'}
          >
            <div
              className="map-feature-click-target"
              data-map-feature-kind="point"
              onClick={(event) => {
                if (!selectable) return;
                event.stopPropagation();
                onFeatureSelect?.(feature, 'point');
              }}
              onMouseDown={(event) => {
                if (!selectable) return;
                event.stopPropagation();
              }}
              style={{
                width,
                height,
                pointerEvents: selectable ? 'auto' : 'none',
                cursor: selectable ? 'pointer' : 'default',
              }}
            >
              {renderPointIcon(pointStyle, feature)}
            </div>
          </Marker>
        );
      })}
    </>
  );
};

export default PointRenderer;
