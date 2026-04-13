import coordtransform from 'coordtransform';

const MAPBOX_DIRECTIONS_API = 'https://api.mapbox.com/directions/v5/mapbox/walking';

export interface TransformedMapData {
  points: any[];
  lines: any[];
  polygons: any[];
  globalProps: any;
}
export const transformSingleCoordinate = (coord: number[]) => {
  return coordtransform.gcj02towgs84(...coord);
}
export const transformAllCoordinates = (geojson: any): TransformedMapData => {
  if (!geojson?.features) {
    return { points: [], lines: [], polygons: [], globalProps: geojson?.global_properties };
  }

  const points: any[] = [];
  const lines: any[] = [];
  const polygons: any[] = [];
  for (const feature of geojson.features) {
    const transformedFeature = JSON.parse(JSON.stringify(feature));
    if (feature.geometry?.type === 'Point') {
      const coord = coordtransform.gcj02towgs84(...feature.geometry.coordinates);
      transformedFeature.geometry.coordinates = coord;
      transformedFeature.properties = transformedFeature.properties || {};
      transformedFeature.properties.coordinates = coord;
      
      if (feature.properties?.card_coord) {
        transformedFeature.properties.card_coord = coordtransform.gcj02towgs84(...feature.properties.card_coord);
      }
      if (feature.properties?.label_coord) {
        transformedFeature.properties.label_coord = coordtransform.gcj02towgs84(...feature.properties.label_coord);
      }
      
      points.push(transformedFeature);
    } else if (feature.geometry?.type === 'LineString') {
      const coords = feature.geometry.coordinates;
      const transformedCoords = coords.map((c: number[]) => coordtransform.gcj02towgs84(...c));
      transformedFeature.geometry.coordinates = transformedCoords;
      lines.push(transformedFeature);
    } else if (feature.geometry?.type === 'Polygon') {
      const coords = feature.geometry.coordinates;
      const transformedCoords = coords.map((ring: number[][]) => 
        ring.map((c: number[]) => coordtransform.gcj02towgs84(...c))
      );
      transformedFeature.geometry.coordinates = transformedCoords;
      polygons.push(transformedFeature);
    }
    
  }
  return {
    points,
    lines,
    polygons,
    globalProps: geojson.global_properties
  };
};

export async function fetchWalkingRoute(
  coordinates: number[][],
  token: string
): Promise<number[][]> {
  const MAX_WAYPOINTS = 5;
  
  if (coordinates.length > MAX_WAYPOINTS) {
    const allRoutes: number[][] = [];
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
    
    if (url.length > 2000) {
      console.warn('URL length exceeds limit, using straight line');
      return coordinates;
    }

    const res = await fetch(url);
    
    if (!res.ok) {
      throw new Error(`Mapbox API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    if (data.message) {
      throw new Error(`Mapbox API error: ${data.message}`);
    }

    const routeCoords = data.routes?.[0]?.geometry?.coordinates;
    if (routeCoords) {
      return routeCoords;
    } else {
      console.warn('Mapbox API returned no route data');
      return coordinates;
    }
  } catch (e) {
    console.warn('Mapbox Directions API failed, using straight line:', e);
    return coordinates;
  }
}

async function fetchSingleRoute(
  coordinates: number[][],
  token: string
): Promise<number[][]> {
  try {
    const coords = coordinates.map((c) => `${c[0]},${c[1]}`).join(';');
    const url = `${MAPBOX_DIRECTIONS_API}/${coords}?geometries=geojson&access_token=${token}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Segment request failed: ${res.status}`);
    const data = await res.json();
    return data.routes?.[0]?.geometry?.coordinates || coordinates;
  } catch (e) {
    console.warn('Single segment request failed, using straight line:', e);
    return coordinates;
  }
}

export const populateTemplate = (template: string, properties: any, globalProperties?: any) => {
  let html = template;
  
  const doubleBraceRegex = /\{\{(?:properties|global_properties\[\d+\])\.([^}]+)\}\}/g;
  html = html.replace(doubleBraceRegex, (match, key) => {
    if (match.includes('global_properties')) {
      const indexMatch = match.match(/global_properties\[(\d+)\]/);
      if (indexMatch) {
        const index = parseInt(indexMatch[1]);
        if (globalProperties && Array.isArray(globalProperties) && index < globalProperties.length) {
          return globalProperties[index]?.[key] || '';
        }
      }
      return '';
    }
    return properties?.[key] || '';
  });
  
  const singleBraceRegex = /\{(?:properties|global_properties\[\d+\])\.([^}]+)\}/g;
  html = html.replace(singleBraceRegex, (match, key) => {
    if (match.includes('global_properties')) {
      const indexMatch = match.match(/global_properties\[(\d+)\]/);
      if (indexMatch) {
        const index = parseInt(indexMatch[1]);
        if (globalProperties && Array.isArray(globalProperties) && index < globalProperties.length) {
          return globalProperties[index]?.[key] || '';
        }
      }
      return '';
    }
    return properties?.[key] || '';
  });

  // html = html.replace(/\s*transform:[^;]+;?/gi, '');
  // console.log(html);
  return html;
};

export const calculateMapViewState = (transformedData: TransformedMapData) => {
  const { points, lines, polygons } = transformedData;
  
  if (points.length === 0 && lines.length === 0 && polygons.length === 0) {
    return {
      longitude: 116.397,
      latitude: 39.94,
      zoom: 10.5,
    };
  }

  const coords: number[][] = [];

  points.forEach((feature: any) => {
    coords.push(feature.geometry.coordinates);
  });

  lines.forEach((feature: any) => {
    feature.geometry.coordinates.forEach((coord: number[]) => {
      coords.push(coord);
    });
  });

  polygons.forEach((feature: any) => {
    feature.geometry.coordinates.forEach((ring: number[][]) => {
      ring.forEach((coord: number[]) => {
        coords.push(coord);
      });
    });
  });

  if (coords.length === 0) {
    return {
      longitude: 116.397,
      latitude: 39.94,
      zoom: 10.5,
    };
  }

  const lons = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  
  const minLng = Math.min(...lons) - 0.01;
  const maxLng = Math.max(...lons) + 0.01;
  const minLat = Math.min(...lats) - 0.01;
  const maxLat = Math.max(...lats) + 0.01;

  const centerLng = (minLng + maxLng) / 2;
  const centerLat = (minLat + maxLat) / 2;
  const lngDiff = maxLng - minLng;
  const latDiff = maxLat - minLat;
  
  const lngZoom = Math.log2(360 / lngDiff);
  const latZoom = Math.log2(180 / latDiff);
  const zoom = Math.min(15, Math.max(8, Math.min(lngZoom, latZoom) - 0.5));

  return {
    longitude: centerLng,
    latitude: centerLat,
    zoom: zoom,
  };
};
