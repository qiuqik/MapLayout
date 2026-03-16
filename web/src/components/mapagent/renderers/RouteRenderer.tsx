'use client';

import { Source, Layer } from 'react-map-gl/mapbox';

interface RouteRendererProps {
  routeStyles: any[];
  transformedLayers: any;
}

const RouteRenderer: React.FC<RouteRendererProps> = ({ routeStyles, transformedLayers }) => {
  return (
    <>
      {routeStyles.map((routeStyle: any) => {
        const routeFeatures = transformedLayers.features.filter((f: any) => 
          f.geometry?.type === 'LineString' && f.properties?.visual_id === routeStyle.visual_id
        );
        if (routeFeatures.length === 0) return null;
        
        return (
          <Source key={routeStyle.visual_id} id={`route-${routeStyle.visual_id}`} type="geojson" data={{
            type: 'FeatureCollection',
            features: routeFeatures
          }}>
            <Layer
              id={routeStyle.visual_id}
              type="line"
              paint={{
                'line-color': routeStyle.color,
                'line-width': routeStyle.width,
              }}
            />
          </Source>
        );
      })}
    </>
  );
};

export default RouteRenderer;
