'use client';

import { Marker } from 'react-map-gl/mapbox';
import { API_BASE_URL } from '@/lib/api';

interface PointRendererProps {
  points: any[];
  pointStyles: any[];
  globalProps?: any;
}

const PointRenderer: React.FC<PointRendererProps> = ({ points, pointStyles }) => {
  const renderPointIcon = (pointStyle: any, feature: any) => {
    const rawIconSrc = pointStyle.url;
    const iconSrc = rawIconSrc
      ? String(rawIconSrc).startsWith('http')
        ? rawIconSrc
        : `${API_BASE_URL}${rawIconSrc}`
      : '';
    const visualStyle = pointStyle.style && typeof pointStyle.style === 'object' ? pointStyle.style : {};
    const size = Number(visualStyle.size || pointStyle.size || 28);
    const fallbackColor = visualStyle.color || pointStyle.color || '#E4572E';

    if (iconSrc) {
      return (
        <img
          src={iconSrc}
          alt={feature.properties?.name || pointStyle['icon描述'] || 'POI'}
          style={{
            width: size,
            height: size,
            objectFit: 'contain',
            display: 'block',
            filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.25))',
          }}
        />
      );
    }

    return (
      <span
        style={{
          width: Math.max(12, size * 0.58),
          height: Math.max(12, size * 0.58),
          borderRadius: '999px',
          background: fallbackColor,
          border: '2px solid #fff',
          boxShadow: '0 1px 4px rgba(0,0,0,0.28)',
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
        
        return (
          <Marker
            key={feature.properties?.name || feature.properties?.visual_id}
            longitude={lng}
            latitude={lat}
            anchor="bottom"
          >
            <div
            style={{
                width: Number(pointStyle.style?.size || pointStyle.size || 28),
                height: Number(pointStyle.style?.size || pointStyle.size || 28),
                pointerEvents: 'none',
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
