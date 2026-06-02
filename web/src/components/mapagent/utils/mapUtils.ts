export interface TransformedMapData {
  points: any[];
  lines: any[];
  globalProps: any;
}

// 后端已返回 WGS84 坐标，不再需要转换
export const transformSingleCoordinate = (coord: number[]) => {
  return coord; // 直接返回
}

export const transformAllCoordinates = (geojson: any): TransformedMapData => {
  if (!geojson?.features) {
    return { points: [], lines: [], globalProps: geojson?.global_properties };
  }

  const points: any[] = [];
  const lines: any[] = [];
  for (const feature of geojson.features) {
    const transformedFeature = JSON.parse(JSON.stringify(feature));
    if (feature.geometry?.type === 'Point') {
      transformedFeature.properties = transformedFeature.properties || {};
      transformedFeature.properties.coordinates = feature.geometry.coordinates;

      if (feature.properties?.label_coord) {
        transformedFeature.properties.label_coord = feature.properties.label_coord;
      }

      points.push(transformedFeature);
    } else if (feature.geometry?.type === 'LineString') {
      lines.push(transformedFeature);
    }
  }
  return {
    points,
    lines,
    globalProps: geojson.global_properties
  };
};

export const normalizeLabelHierarchy = (value: unknown, fallback: 'core' | 'secondary' | 'detail' = 'secondary') => {
  const aliases: Record<string, 'core' | 'secondary' | 'detail'> = {
    core: 'core',
    '核心标签': 'core',
    secondary: 'secondary',
    '次要标签': 'secondary',
    detail: 'detail',
    '详细标签': 'detail',
  };
  return aliases[String(value ?? '').trim()] ?? fallback;
};

export const normalizeLabelContentType = (
  value: unknown,
  fallback: 'title' | 'title_script' | 'title_script_extra' = 'title_script',
) => {
  const aliases: Record<string, 'title' | 'title_script' | 'title_script_extra'> = {
    title: 'title',
    '只包含title': 'title',
    '只包含 title': 'title',
    title_script: 'title_script',
    'title+script': 'title_script',
    '包含title+script': 'title_script',
    '包含 title+script': 'title_script',
    title_script_extra: 'title_script_extra',
    'title+script+extra info': 'title_script_extra',
  };
  return aliases[String(value ?? '').trim()] ?? fallback;
};

export const selectLabelStyleForFeature = (feature: any, labelStyles: any[]) => {
  const props = feature?.properties || {};
  const hierarchy = normalizeLabelHierarchy(props.label_level ?? props.hierarchy);
  const contentType = normalizeLabelContentType(
    props.label_content_type ?? props.content_type,
    hierarchy === 'detail' ? 'title_script_extra' : 'title_script',
  );

  return (
    labelStyles.find((style: any) =>
      normalizeLabelHierarchy(style?.hierarchy) === hierarchy &&
      normalizeLabelContentType(style?.content_type, contentType) === contentType
    ) ||
    labelStyles.find((style: any) => normalizeLabelHierarchy(style?.hierarchy) === hierarchy) ||
    labelStyles[0]
  );
};

export const getFeatureLabelId = (feature: any, labelStyle?: any) => {
  const props = feature?.properties || {};
  const base = props.feature_id || [feature?.geometry?.type, props.day, props.order, props.name || props.label_title]
    .filter(Boolean)
    .join('-');
  const hierarchy = normalizeLabelHierarchy(props.label_level ?? props.hierarchy ?? labelStyle?.hierarchy);
  const contentType = normalizeLabelContentType(
    props.label_content_type ?? props.content_type ?? labelStyle?.content_type,
    hierarchy === 'detail' ? 'title_script_extra' : 'title_script',
  );
  return `label-${base || 'poi'}-${hierarchy}-${contentType}`;
};

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const toKebab = (value: string) => value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);

const unitlessCss = new Set(['opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flex', 'order']);

const scalePx = (value: string) => value.replace(
  /(-?\d+(?:\.\d+)?)px/g,
  (_, amount) => `calc(var(--map-label-scale, 1) * ${amount}px)`,
);

const cssValue = (key: string, value: any, scaleNumeric = false) => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'number') {
    if (unitlessCss.has(key)) return String(value);
    return scaleNumeric ? `calc(var(--map-label-scale, 1) * ${value}px)` : `${value}px`;
  }
  const text = String(value);
  return scaleNumeric ? scalePx(text) : text;
};

export const styleObjectToCss = (style: Record<string, any> = {}, scaleNumeric = false) => {
  return Object.entries(style)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${toKebab(key)}:${cssValue(key, value, scaleNumeric)}`)
    .join(';');
};

const styleSection = (style: any, section: string) => (
  style && typeof style === 'object' && style[section] && typeof style[section] === 'object'
    ? style[section]
    : {}
);

export const buildLabelHtml = (feature: any, labelStyle: any) => {
  const props = feature?.properties || {};
  const hierarchy = normalizeLabelHierarchy(props.label_level ?? props.hierarchy ?? labelStyle?.hierarchy);
  const contentType = normalizeLabelContentType(
    props.label_content_type ?? props.content_type ?? labelStyle?.content_type,
    hierarchy === 'detail' ? 'title_script_extra' : 'title_script',
  );
  const title = props.label_title || props.name || '';
  const script = props.label_script || props.description || '';
  const extra = props.label_extra_info || props.extra_info || '';
  const width = Number(labelStyle?.width) || (hierarchy === 'core' ? 220 : hierarchy === 'secondary' ? 190 : 170);
  const minHeight = Number(labelStyle?.height) || (hierarchy === 'core' ? 80 : hierarchy === 'secondary' ? 64 : 72);
  const style = labelStyle?.style && typeof labelStyle.style === 'object' ? labelStyle.style : {};
  const containerStyle = style.container && typeof style.container === 'object' ? style.container : style;
  const titleStyle = styleSection(style, 'title');
  const scriptStyle = styleSection(style, 'script');
  const extraStyle = styleSection(style, 'extra_info');
  const baseCss = styleObjectToCss({
    boxSizing: 'border-box',
    width,
    minHeight,
    maxWidth: width,
    overflow: 'hidden',
    ...containerStyle,
  }, true);
  const titleCss = styleObjectToCss({
    fontWeight: hierarchy === 'core' ? 800 : 700,
    fontSize: hierarchy === 'core' ? 14 : 12,
    lineHeight: 1.25,
    marginBottom: script ? 4 : 0,
    ...titleStyle,
  }, true);
  const scriptCss = styleObjectToCss({
    fontSize: hierarchy === 'core' ? 12 : 11,
    lineHeight: 1.35,
    opacity: 0.82,
    marginTop: 2,
    ...scriptStyle,
  }, true);
  const extraCss = styleObjectToCss({
    fontSize: 10,
    lineHeight: 1.25,
    opacity: 0.72,
    marginTop: 4,
    ...extraStyle,
  }, true);

  return [
    `<div class="map-label map-label-${hierarchy}" style="${baseCss}">`,
    title ? `<div class="map-label-title" style="${titleCss}">${escapeHtml(title)}</div>` : '',
    contentType !== 'title' && script ? `<div class="map-label-script" style="${scriptCss}">${escapeHtml(script)}</div>` : '',
    contentType === 'title_script_extra' && extra ? `<div class="map-label-extra" style="${extraCss}">${escapeHtml(extra)}</div>` : '',
    '</div>',
  ].join('');
};

export const calculateMapViewState = (transformedData: TransformedMapData) => {
  const { points, lines } = transformedData;
  
  if (points.length === 0 && lines.length === 0) {
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
