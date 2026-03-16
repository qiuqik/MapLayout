'use client';

import { Source, Layer } from 'react-map-gl/mapbox';

interface AreaRendererProps {
  areaStyles: any[];
  transformedLayers: any;
}

const AreaRenderer: React.FC<AreaRendererProps> = ({ areaStyles, transformedLayers }) => {
  return (
    <>
      {areaStyles.map((areaStyle: any) => {
        const areaFeatures = transformedLayers.features.filter((f: any) => 
          f.geometry?.type === 'Polygon' && f.properties?.visual_id === areaStyle.visual_id
        );
        if (areaFeatures.length === 0) return null;
        
        return (
          <Source key={areaStyle.visual_id} id={`area-${areaStyle.visual_id}`} type="geojson" data={{
            type: 'FeatureCollection',
            features: areaFeatures
          }}>
            <Layer
              id={areaStyle.visual_id}
              type="fill"
              paint={{
                'fill-color': areaStyle.backgroundColor,
                'fill-opacity': areaStyle.opacity,
                'fill-outline-color': areaStyle.borderColor,
              }}
            />
          </Source>
        );
      })}
    </>
  );
};

export default AreaRenderer;
