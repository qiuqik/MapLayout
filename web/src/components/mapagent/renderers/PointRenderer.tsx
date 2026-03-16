'use client';

import { Marker } from 'react-map-gl/mapbox';

interface PointRendererProps {
  points: any[];
  pointStyles: any[];
}

const PointRenderer: React.FC<PointRendererProps> = ({ points, pointStyles }) => {
  return (
    <>
      {points.map((feature: any) => {
        const pointStyle = pointStyles.find(
          (p: any) => p.visual_id === feature.properties?.visual_id
        );
        if (!pointStyle) return null;

        const [lng, lat] = feature.geometry.coordinates;
        // console.log(pointStyle.iconSvg);
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
              dangerouslySetInnerHTML={{ __html: pointStyle.iconSvg }}
            />
            {/* <div>{feature.properties?.name}</div> */}
          </Marker>
        );
      })}
    </>
  );
};

export default PointRenderer;
