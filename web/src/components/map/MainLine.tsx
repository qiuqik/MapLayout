'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { Source, Layer, LayerProps } from 'react-map-gl/mapbox';

export interface RoutesStyle {
  color?: string;
  width?: number;
  lineStatus?: 'StraightLine' | 'SmoothCurve' | 'NavigationCurve';
}

interface MainLineProps {
  geojson: GeoJSON.FeatureCollection;
  routesStyle: RoutesStyle;
  mapboxToken?: string;
}

const MAPBOX_DIRECTIONS_API = 'https://api.mapbox.com/directions/v5/mapbox/walking';

async function fetchWalkingRoute(
  coordinates: number[][],
  token: string
): Promise<GeoJSON.Position[]> {
  try {
    const coords = coordinates.map((c) => `${c[0]},${c[1]}`).join(';');
    const url = `${MAPBOX_DIRECTIONS_API}/${coords}?geometries=geojson&access_token=${token}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.routes?.[0]?.geometry?.coordinates) {
      return data.routes[0].geometry.coordinates;
    }
  } catch (e) {
    console.warn('Mapbox Directions API 失败，使用直线:', e);
  }
  return coordinates;
}

async function buildNavigationGeoJSON(
  lineFeatures: GeoJSON.Feature<GeoJSON.LineString>[],
  token: string
): Promise<GeoJSON.FeatureCollection<GeoJSON.LineString>> {
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  for (const feat of lineFeatures) {
    const coords = feat.geometry.coordinates;
    if (coords.length < 2) continue;
    const path = await fetchWalkingRoute(coords, token);
    features.push({
      type: 'Feature',
      properties: feat.properties || {},
      geometry: { type: 'LineString', coordinates: path },
    });
  }
  return { type: 'FeatureCollection', features };
}

function smoothCurveCoords(coords: number[][]): number[][] {
  if (coords.length <= 2) return coords;
  const result: number[][] = [coords[0]];
  for (let i = 1; i < coords.length - 1; i++) {
    const prev = coords[i - 1];
    const curr = coords[i];
    const next = coords[i + 1];
    const mid1 = [(prev[0] + curr[0]) / 2, (prev[1] + curr[1]) / 2];
    const mid2 = [(curr[0] + next[0]) / 2, (curr[1] + next[1]) / 2];
    result.push(mid1, curr, mid2);
  }
  result.push(coords[coords.length - 1]);
  return result;
}

const MainLine: React.FC<MainLineProps> = ({ geojson, routesStyle, mapboxToken }) => {
  const [routeData, setRouteData] = useState<GeoJSON.FeatureCollection<GeoJSON.LineString> | null>(null);

  const { color = '#f97316', width = 4, lineStatus = 'StraightLine' } = routesStyle;
  const lineFeatures = useMemo(
    () =>
      geojson?.features?.filter(
        (f): f is GeoJSON.Feature<GeoJSON.LineString> =>
          f.geometry?.type === 'LineString'
      ) ?? [],
    [geojson]
  );

  useEffect(() => {
    if (!lineFeatures.length) {
      setRouteData(null);
      return;
    }

    if (lineStatus === 'NavigationCurve' && mapboxToken) {
      buildNavigationGeoJSON(lineFeatures, mapboxToken)
        .then(setRouteData)
        .catch((e) => {
          console.warn('NavigationCurve 失败，回退到直线:', e);
          setRouteData({ type: 'FeatureCollection', features: lineFeatures });
        });
    } else if (lineStatus === 'SmoothCurve') {
      const features = lineFeatures.map((f) => ({
        ...f,
        geometry: {
          type: 'LineString' as const,
          coordinates: smoothCurveCoords(f.geometry.coordinates),
        },
      }));
      setRouteData({ type: 'FeatureCollection', features });
    } else {
      setRouteData({ type: 'FeatureCollection', features: lineFeatures });
    }
  }, [lineStatus, lineFeatures, mapboxToken]);

  if (!routeData?.features?.length) return null;

  const lineLayerStyle: LayerProps = {
    id: 'main-route-line',
    type: 'line',
    layout: {
      'line-join': lineStatus === 'SmoothCurve' ? 'round' : 'miter',
      'line-cap': 'round',
    },
    paint: {
      'line-color': color,
      'line-width': width,
    },
  };

  return (
    <Source id="main-route-source" type="geojson" data={routeData}>
      <Layer {...lineLayerStyle} />
    </Source>
  );
};

export default MainLine;
