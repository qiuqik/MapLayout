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

const routeSignedArea = (coords: number[][]) => {
  let area = 0;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const [x1, y1] = coords[i];
    const [x2, y2] = coords[i + 1];
    area += x1 * y2 - x2 * y1;
  }
  return area;
};

const catmullRomPoint = (
  p0: number[],
  p1: number[],
  p2: number[],
  p3: number[],
  t: number,
) => {
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    0.5 * (
      (2 * p1[0]) +
      (-p0[0] + p2[0]) * t +
      (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
      (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3
    ),
    0.5 * (
      (2 * p1[1]) +
      (-p0[1] + p2[1]) * t +
      (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
      (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3
    ),
  ];
};

const buildCurveCoords = (coords: number[][]) => {
  if (coords.length < 3) return coords;
  const routeArea = routeSignedArea(coords);
  const side = routeArea >= 0 ? 1 : -1;
  const lons = coords.map((coord) => coord[0]);
  const lats = coords.map((coord) => coord[1]);
  const routeSpan = Math.hypot(
    Math.max(...lons) - Math.min(...lons),
    Math.max(...lats) - Math.min(...lats),
  );
  const maxBulge = Math.min(0.045, Math.max(0.002, routeSpan * 0.075));
  const result: number[][] = [];

  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[Math.max(0, i - 1)];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[Math.min(coords.length - 1, i + 2)];
    const segmentDx = p2[0] - p1[0];
    const segmentDy = p2[1] - p1[1];
    const segmentDistance = Math.hypot(segmentDx, segmentDy) || 1;
    const normal = [-(segmentDy / segmentDistance) * side, (segmentDx / segmentDistance) * side];

    for (let step = 0; step <= 18; step++) {
      if (i > 0 && step === 0) continue;
      const t = step / 18;
      const point = catmullRomPoint(p0, p1, p2, p3, t);
      const globalProgress = (i + t) / Math.max(1, coords.length - 1);
      const bulge = Math.sin(Math.PI * globalProgress) * Math.min(maxBulge, segmentDistance * 0.22);
      result.push([
        point[0] + normal[0] * bulge,
        point[1] + normal[1] * bulge,
      ]);
    }
  }
  if (result.length > 0) {
    result[0] = coords[0];
    result[result.length - 1] = coords[coords.length - 1];
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
