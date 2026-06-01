'use client';

import { Marker } from 'react-map-gl/mapbox';
import { populateTemplate } from '../utils/mapUtils';

interface PointRendererProps {
  points: any[];
  pointStyles: any[];
  globalProps?: any;
}

const PointRenderer: React.FC<PointRendererProps> = ({ points, pointStyles, globalProps = {} }) => {
  const renderPointIcon = (pointStyle: any, feature: any) => {
    const iconSrc = pointStyle.iconDataUrl || pointStyle.iconUrl;
    const fallbackColor = pointStyle.iconFallbackColor || pointStyle.color || '#E4572E';

    if (iconSrc) {
      return (
        <img
          src={iconSrc}
          alt={feature.properties?.name || pointStyle.iconDescription || 'POI'}
          style={{
            width: 28,
            height: 28,
            objectFit: 'contain',
            display: 'block',
            filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.25))',
          }}
        />
      );
    }

    if (pointStyle.template || pointStyle.iconSvg) {
      const htmlStr = populateTemplate(pointStyle.template || pointStyle.iconSvg, feature.properties, globalProps);
      return <div dangerouslySetInnerHTML={{ __html: htmlStr }} />;
    }

    return (
      <span
        style={{
          width: 16,
          height: 16,
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
                width: 28,
                height: 28,
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
