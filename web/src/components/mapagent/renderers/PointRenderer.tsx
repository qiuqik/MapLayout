'use client';

import { Marker } from 'react-map-gl/mapbox';
import { populateTemplate } from '../utils/mapUtils';

interface PointRendererProps {
  points: any[];
  pointStyles: any[];
  globalProps?: any;
}

const PointRenderer: React.FC<PointRendererProps> = ({ points, pointStyles, globalProps = {} }) => {
  return (
    <>
      {points.map((feature: any) => {
        const pointStyle = pointStyles.find(
          (p: any) => p.visual_id === feature.properties?.visual_id
        );
        if (!pointStyle) return null;

        const [lng, lat] = feature.geometry.coordinates;
        const htmlStr = populateTemplate(pointStyle.template || pointStyle.iconSvg, feature.properties, globalProps);
        
        return (
          <Marker
            key={feature.properties?.name || feature.properties?.visual_id}
            longitude={lng}
            latitude={lat}
            anchor="bottom"
          >
            <div
              style={{
                width: 24,
                height: 24,
                pointerEvents: 'none',
              }}
              dangerouslySetInnerHTML={{ __html: htmlStr }}
            />
            {/* <div>{feature.properties?.name}</div> */}
          </Marker>
        );
      })}
    </>
  );
};

export default PointRenderer;
