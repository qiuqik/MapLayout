'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { Source, Layer, LayerProps } from 'react-map-gl/mapbox';

export interface RoutesStyle {
  color?: string;
  width?: number;
  style?: 'straightLine' | 'smoothCurve' | 'navigationCurve';
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
  const MAX_WAYPOINTS = 5;
  if (coordinates.length > MAX_WAYPOINTS) {
    console.warn(`自动截断并分段规划`);
    // 分段规划
    const allRoutes: GeoJSON.Position[] = [];
    for (let i = 0; i < coordinates.length - 1; i += MAX_WAYPOINTS - 1) {
      const segment = coordinates.slice(i, i + MAX_WAYPOINTS);
      const segmentRoute = await fetchSingleRoute(segment, token);
      allRoutes.push(...segmentRoute);
    }
    return allRoutes;
  }

  try {
    const coords = coordinates.map((c) => `${c[0]},${c[1]}`).join(';');
    const url = `${MAPBOX_DIRECTIONS_API}/${coords}?geometries=geojson&access_token=${token}`;
    
    // 检查URL长度，避免超出浏览器限制
    if (url.length > 2000) {
      console.warn('URL长度超出限制，使用直线');
      return coordinates;
    }

    const res = await fetch(url);
    
    if (!res.ok) {
      throw new Error(`Mapbox API 返回错误: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    if (data.message) {
      throw new Error(`Mapbox API 错误: ${data.message}`);
    }

    const routeCoords = data.routes?.[0]?.geometry?.coordinates;
    if (routeCoords) {
      return routeCoords;
    } else {
      console.warn('Mapbox API 返回无路线数据');
      return coordinates;
    }
  } catch (e) {
    console.warn('Mapbox Directions API 失败，使用直线:', e);
    return coordinates;
  }
}

// 单次请求单段路线
async function fetchSingleRoute(
  coordinates: number[][],
  token: string
): Promise<GeoJSON.Position[]> {
  try {
    const coords = coordinates.map((c) => `${c[0]},${c[1]}`).join(';');
    const url = `${MAPBOX_DIRECTIONS_API}/${coords}?geometries=geojson&access_token=${token}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`段请求失败: ${res.status}`);
    const data = await res.json();
    return data.routes?.[0]?.geometry?.coordinates || coordinates;
  } catch (e) {
    console.warn('单段路线请求失败，使用直线:', e);
    return coordinates;
  }
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

  const { color = '#f97316', width = 4, style = 'straightLine' } = routesStyle;
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

    if (style === 'navigationCurve' && mapboxToken) {
      buildNavigationGeoJSON(lineFeatures, mapboxToken)
        .then(setRouteData)
        .catch((e) => {
          console.warn('NavigationCurve 失败，回退到直线:', e);
          setRouteData({ type: 'FeatureCollection', features: lineFeatures });
        });
    } else if (style === 'smoothCurve') {
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
  }, [style, lineFeatures, mapboxToken]);

  if (!routeData?.features?.length) return null;

  const lineLayerStyle: LayerProps = {
    id: 'main-route-line',
    type: 'line',
    layout: {
      'line-join': style === 'smoothCurve' ? 'round' : 'miter',
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
