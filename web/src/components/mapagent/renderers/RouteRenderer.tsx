'use client';

import { Source, Layer } from 'react-map-gl/mapbox';

interface RouteRendererProps {
  routeStyles: any[];
  transformedLayers: any;
  selectedRouteId?: string | null;
  visualScale?: number;
}

type RouteRenderStyle = 'straight' | 'bezier' | 'navigation';

const routeStyleAliases: Record<string, RouteRenderStyle> = {
  straight: 'straight',
  line: 'straight',
  direct: 'straight',
  直线: 'straight',
  bezier: 'bezier',
  贝塞尔: 'bezier',
  曲线: 'bezier',
  navigation: 'navigation',
  导航: 'navigation',
  导航路线: 'navigation',
};

const normalizeRouteStyle = (value: unknown): RouteRenderStyle => {
  const key = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
  return routeStyleAliases[key] ?? 'bezier';
};

const numericArray = (value: unknown): number[] => (
  Array.isArray(value)
    ? value.map(Number).filter((item) => Number.isFinite(item) && item > 0)
    : []
);

const buildCurveCoords = (coords: number[][]) => {
  if (coords.length < 3) return coords;
  const result: number[][] = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const start = coords[i];
    const end = coords[i + 1];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
    const bend = Math.min(0.018, distance * 0.18) * (i % 2 === 0 ? 1 : -1);
    const control = [
      (start[0] + end[0]) / 2 - (dy / distance) * bend,
      (start[1] + end[1]) / 2 + (dx / distance) * bend,
    ];

    for (let step = 0; step <= 14; step++) {
      if (i > 0 && step === 0) continue;
      const t = step / 14;
      const oneMinusT = 1 - t;
      result.push([
        oneMinusT * oneMinusT * start[0] + 2 * oneMinusT * t * control[0] + t * t * end[0],
        oneMinusT * oneMinusT * start[1] + 2 * oneMinusT * t * control[1] + t * t * end[1],
      ]);
    }
  }
  return result;
};

const shapeRouteFeature = (feature: any, renderStyle: RouteRenderStyle) => {
  if (renderStyle !== 'bezier') return feature;
  const coordinates = feature.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 3) return feature;
  return {
    ...feature,
    geometry: {
      ...feature.geometry,
      coordinates: buildCurveCoords(coordinates),
    },
  };
};

const RouteRenderer: React.FC<RouteRendererProps> = ({ routeStyles, transformedLayers, selectedRouteId, visualScale = 1 }) => {
  return (
    <>
      {routeStyles.map((routeStyle: any) => {
        const renderStyle = normalizeRouteStyle(routeStyle.style);
        const routeFeatures = transformedLayers.features
          .filter((f: any) => f.geometry?.type === 'LineString' && f.properties?.visual_id === routeStyle.visual_id)
          .map((feature: any) => shapeRouteFeature(feature, renderStyle));

        if (routeFeatures.length === 0) return null;

        const linePattern = String(routeStyle.linePattern || routeStyle.pattern || 'solid').toLowerCase();
        const lineColor = routeStyle.Color || routeStyle.color || '#E4572E';
        const baseLineWidth = Number(routeStyle.width || 4) * visualScale;
        const lineWidth = Math.max(1.5, baseLineWidth + (selectedRouteId === routeStyle.visual_id ? 2 * visualScale : 0));
        const dashArray = numericArray(routeStyle.dashArray || routeStyle.dasharray);
        const shouldDrawArrows = routeStyle.arrow !== false;

        return (
          <Source key={routeStyle.visual_id} id={`route-${routeStyle.visual_id}`} type="geojson" data={{
            type: 'FeatureCollection',
            features: routeFeatures,
          }}>
            <Layer
              id={`${routeStyle.visual_id}-line`}
              type="line"
              layout={{
                'line-cap': 'round',
                'line-join': 'round',
              }}
              paint={{
                'line-color': lineColor,
                'line-width': lineWidth,
                'line-opacity': routeStyle.opacity ?? 0.92,
                ...(linePattern === 'dashed' ? { 'line-dasharray': dashArray.length ? dashArray : [1.4, 1.2] } : {}),
              }}
            />
            {shouldDrawArrows && (
              <Layer
                id={`${routeStyle.visual_id}-arrows`}
                type="symbol"
                layout={{
                  'symbol-placement': 'line',
                  'symbol-spacing': Math.max(76, Math.round(120 * visualScale)),
                  'text-field': '➜',
                  'text-size': Math.max(10, lineWidth * 3.2),
                  'text-allow-overlap': true,
                  'text-ignore-placement': true,
                  'text-keep-upright': false,
                }}
                paint={{
                  'text-color': lineColor,
                  'text-halo-color': '#FFFFFF',
                  'text-halo-width': 1,
                }}
              />
            )}
          </Source>
        );
      })}
    </>
  );
};

export default RouteRenderer;
