export interface TransformedMapData {
  points: any[];
  lines: any[];
  polygons: any[];
  globalProps: any;
}

// 后端已返回 WGS84 坐标，不再需要转换
export const transformSingleCoordinate = (coord: number[]) => {
  return coord; // 直接返回
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
      transformedFeature.properties = transformedFeature.properties || {};
      transformedFeature.properties.coordinates = feature.geometry.coordinates;

      if (feature.properties?.card_coord) {
        transformedFeature.properties.card_coord = feature.properties.card_coord;
      }
      if (feature.properties?.label_coord) {
        transformedFeature.properties.label_coord = feature.properties.label_coord;
      }

      points.push(transformedFeature);
    } else if (feature.geometry?.type === 'LineString') {
      lines.push(transformedFeature);
    } else if (feature.geometry?.type === 'Polygon') {
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
