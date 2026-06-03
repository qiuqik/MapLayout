'use client';
import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import MapGL, { MapRef } from 'react-map-gl/mapbox';
import { DownloadIcon, HandIcon, MousePointer2Icon, SearchIcon, ZoomInIcon, ZoomOutIcon } from 'lucide-react';
// @ts-ignore
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  transformAllCoordinates,
  calculateMapViewState,
  TransformedMapData,
  buildLabelHtml,
  getFeatureLabelId,
  selectLabelStyleForFeature,
} from './utils/mapUtils';
import GlobalRenderer from './renderers/GlobalRenderer';
import RouteRenderer from './renderers/RouteRenderer';
import PointRenderer from './renderers/PointRenderer';
import LabelRenderer from './renderers/LabelRenderer';
import DraggableOutput from './DraggableOutput';

import type { LayoutItemContentType, LayoutItemHierarchy, LayoutItemInput, LayoutItemOutput, LayoutItemPosition, LayoutRunMetadata, LeaderLine, Rect } from '@/app/agent/layout/types';
import { buildObstacleRects, buildObstacleSegments } from '@/app/agent/layout/obstacles';
import { buildCostFieldFromRects, type CostField } from '@/app/agent/layout/costField';
import { runForceLayout, type LayoutParams } from '@/app/agent/layout/forceLayout';
import { runSimulatedAnnealingLayout, DEFAULT_SIM_ANNEALING } from '@/app/agent/simulatedAnnealing/simulatedAnnealingLayout';
import { runVoronoiForceLayout, DEFAULT_VORONOI, DEFAULT_VORONOI_FORCE } from '@/app/agent/weightedVoronoi/weightedVoronoiLayout';
import DebugOverlay from './DebugOverlay';
import type { ForceParamsOverride, FieldParamsOverride } from './ForceParamsPanel';
import { useAgentMap } from '@/lib/agentMapContext';

type MapSearchResult = {
  id: string;
  source: 'trip' | 'map' | 'place';
  name: string;
  description?: string;
  coordinates: [number, number];
};

const DEFAULT_FORCE: LayoutParams = {
  seed: 1,
  linkStrength: 0.16,
  collideStrength: 3.5,
  fieldStrength: 1.8,
  boundsPadding: 12,
  alpha: 1,
  alphaDecay: 0.045,
  alphaMin: 0.001,
  iterations: 2000,
  leaderThreshold: 28,
};

const DEFAULT_FIELD: FieldParamsOverride = {
  sigma: 28,
  strength: 1400,
  obstaclePadding: 6,
  cellSize: 24,
};

const hierarchyAliases: Record<string, LayoutItemHierarchy> = {
  core: 'core',
  '核心标签': 'core',
  secondary: 'secondary',
  '次要标签': 'secondary',
  detail: 'detail',
  '详细标签': 'detail',
};

const contentTypeAliases: Record<string, LayoutItemContentType> = {
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

function normalizeHierarchy(value: unknown, fallback: LayoutItemHierarchy = 'secondary'): LayoutItemHierarchy {
  return hierarchyAliases[String(value ?? '').trim()] ?? fallback;
}

function normalizeContentType(value: unknown, fallback: LayoutItemContentType = 'title_script'): LayoutItemContentType {
  if (value && typeof value === 'object') {
    const content = value as Record<string, unknown>;
    if (content.title && content.script && content.extra_info) return 'title_script_extra';
    if (content.title && content.script) return 'title_script';
    if (content.title) return 'title';
  }
  return contentTypeAliases[String(value ?? '').trim()] ?? fallback;
}

function getOverlayMeta(feature: any, style: any, fallbackHierarchy: LayoutItemHierarchy = 'secondary') {
  const hierarchy = normalizeHierarchy(
    feature?.properties?.label_level ?? feature?.properties?.hierarchy ?? style?.level ?? style?.hierarchy,
    fallbackHierarchy,
  );
  const contentType = normalizeContentType(
    feature?.properties?.label_content_type ?? feature?.properties?.content_type ?? style?.content ?? style?.content_type,
    hierarchy === 'detail' ? 'title_script_extra' : 'title_script',
  );
  return { hierarchy, contentType };
}

function getResponsiveOverlayScale(
  hierarchy: LayoutItemHierarchy,
  viewport: { width: number; height: number } | null,
  itemCount: number,
) {
  const width = viewport?.width || 1100;
  const base = Math.min(1, Math.max(0.68, width / 1100));
  const density = itemCount > 24 ? 0.86 : itemCount > 16 ? 0.92 : 1;
  const hierarchyFactor = hierarchy === 'core' ? 1 : hierarchy === 'secondary' ? 0.9 : 0.78;
  return Number((base * density * hierarchyFactor).toFixed(3));
}

function shouldHideOverlay(
  hierarchy: LayoutItemHierarchy,
  viewport: { width: number; height: number } | null,
  itemCount: number,
) {
  const width = viewport?.width || 1100;
  if (hierarchy === 'detail' && (width < 700 || itemCount > 24)) return true;
  if (hierarchy === 'secondary' && width < 460 && itemCount > 12) return true;
  return false;
}

const MAPBOX_LAYER_TARGETS: Record<string, string[]> = {
  background: ['background'],
  land: ['land', 'landcover', 'landuse'],
  water: ['water', 'waterway', 'water-shadow'],
  landuse: ['landuse', 'landcover', 'land-structure-polygon'],
  landuse_park: ['landuse-park', 'national-park', 'park', 'landuse'],
  park: ['landuse-park', 'national-park', 'park', 'landuse'],
  building: ['building', 'building-top', 'building-outline'],
  road_primary: ['road-primary', 'road-motorway-trunk', 'road-major-link'],
  road_secondary: ['road-secondary-tertiary', 'road-street', 'road-minor', 'road-path', 'road-steps'],
  road: ['road-motorway-trunk', 'road-primary', 'road-secondary-tertiary', 'road-street', 'road-minor', 'road-path', 'road-steps'],
  road_label: [
    'road-label',
    'road-label-simple',
    'road-number-shield',
    'road-exit-shield',
    'road-intersection',
    'road-label-navigation',
  ],
  poi_label: ['poi-label', 'transit-label', 'airport-label'],
  place_label: [
    'place-label',
    'settlement-major-label',
    'settlement-minor-label',
    'settlement-subdivision-label',
    'state-label',
    'country-label',
    'continent-label',
  ],
  water_label: ['water-line-label', 'water-point-label'],
  natural_label: ['natural-line-label', 'natural-point-label'],
  label: ['poi-label', 'transit-label', 'airport-label', 'road-label', 'road-label-simple', 'settlement-major-label', 'settlement-minor-label', 'state-label', 'country-label'],
};

const normalizeLayerToken = (value: string) => value.toLowerCase().replace(/[_\s]+/g, '-');

function resolveTargetLayerIds(map: any, target: string) {
  const styleLayers = map.getStyle?.().layers || [];
  const styleLayerIds = new Set(styleLayers.map((layer: any) => layer.id));
  const mappedLayerIds = MAPBOX_LAYER_TARGETS[target] || [];
  const exact = [
    target,
    ...mappedLayerIds,
  ].filter((layerId, index, all) => all.indexOf(layerId) === index && styleLayerIds.has(layerId));
  if (exact.length > 0) return exact;

  const normalizedTarget = normalizeLayerToken(target);
  if (normalizedTarget === 'background') {
    return styleLayers.filter((layer: any) => layer.type === 'background').map((layer: any) => layer.id);
  }

  const semanticTokens = [normalizedTarget, ...mappedLayerIds.map(normalizeLayerToken)]
    .flatMap((item) => [item, item.replace(/-/g, '')])
    .filter((item, index, all) => item.length > 2 && all.indexOf(item) === index);
  return styleLayers
    .filter((layer: any) => {
      const id = normalizeLayerToken(layer.id);
      const compactId = id.replace(/-/g, '');
      return semanticTokens.some((token) => id.includes(token) || compactId.includes(token));
    })
    .map((layer: any) => layer.id);
}

function getVisualStylesheet(visualStructure: any) {
  return visualStructure?.Stylesheet || visualStructure?.stylesheet || null;
}

function resolveMapStyle(visualStructure: any, showHeatmap: boolean) {
  if (showHeatmap) return 'mapbox://styles/mapbox/light-v11';
  const stylesheet = getVisualStylesheet(visualStructure);
  const globalMode = stylesheet?.global || visualStructure?.['Theme&Design']?.global || 'light';
  const hasLayerMappings = Array.isArray(stylesheet?.layers) && stylesheet.layers.length > 0;
  return hasLayerMappings && stylesheet?.mapboxStyle ? stylesheet.mapboxStyle : (globalMode === 'dark'
    ? 'mapbox://styles/mapbox/dark-v11'
    : 'mapbox://styles/mapbox/light-v11');
}

function applyMapboxStylesheet(map: any, visualStructure: any) {
  const stylesheet = getVisualStylesheet(visualStructure);
  if (!map || !stylesheet?.layers?.length) return;

  stylesheet.layers.forEach((entry: any) => {
    if (!entry?.target || !entry.paint || typeof entry.paint !== 'object') return;
    const layerIds = resolveTargetLayerIds(map, entry.target);
    if (layerIds.length === 0) {
      if (!MAPBOX_LAYER_TARGETS[entry.target] && entry.target !== 'background') {
        console.warn(`[Stylesheet] No Mapbox layer matched target "${entry.target}"`);
      }
      return;
    }
    layerIds.forEach((layerId) => {
      Object.entries(entry.paint).forEach(([paintKey, value]) => {
        try {
          map.setPaintProperty(layerId, paintKey, value);
        } catch {
          // Mapbox silently lacks some paint properties on some layer types; skip those.
        }
      });
      if (entry.layout && typeof entry.layout === 'object') {
        Object.entries(entry.layout).forEach(([layoutKey, value]) => {
          try {
            map.setLayoutProperty(layerId, layoutKey, value);
          } catch {
            // Same reason as paint properties.
          }
        });
      }
    });
  });
}

interface TravelMapProps {
  geojson: any;
  styleCode: any;
  visualStructure?: any;
  showHeatmap?: boolean;
  forceParams?: Partial<ForceParamsOverride>;
  fieldParams?: Partial<FieldParamsOverride>;
  draggable?: boolean;
  currentDataset?: 'origin' | 'layout' | 'groundtruth';
  originPositions?: LayoutItemPosition[] | null;
  layoutPositions?: LayoutItemPosition[] | null;
  groundtruthPositions?: LayoutItemPosition[] | null;
  onLayoutOutput?: (outputs: LayoutItemOutput[], inputs: LayoutItemInput[], metadata?: LayoutRunMetadata) => void;
  onGroundtruthChange?: (positions: Record<string, { lng: number; lat: number }>) => void;
  onMapInfoChange?: (mapInfo: { center: { lng: number; lat: number }; bounds: { north: number; south: number; east: number; west: number } }) => void;
  onRouteSelect?: (routeId: string | null) => void;
  selectedRouteId?: string | null;
  rerunLayoutTrigger?: number;
  layoutAlgorithm?: 'force' | 'simulatedAnnealing' | 'weightedVoronoiDirect' | 'weightedVoronoi';
  layoutSeed?: number;
}

export default function TravelMap({ geojson, styleCode, visualStructure, showHeatmap = false, forceParams, fieldParams, draggable = false, currentDataset = 'layout', originPositions, layoutPositions, groundtruthPositions, onLayoutOutput, onGroundtruthChange, onMapInfoChange, onRouteSelect, selectedRouteId, rerunLayoutTrigger = 0, layoutAlgorithm = 'force', layoutSeed = 1 }: TravelMapProps) {
  const { setSelectedAgentSelection } = useAgentMap();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapRef>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [debugCostField, setDebugCostField] = useState<CostField | null>(null);
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number } | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapTool, setMapTool] = useState<'select' | 'pan'>('select');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [mapFrameSize, setMapFrameSize] = useState<{ width: number; height: number }>({ width: 1100, height: 720 });
  const [searchQuery, setSearchQuery] = useState('');
  const [mapLabelMatches, setMapLabelMatches] = useState<MapSearchResult[]>([]);
  const [placeMatches, setPlaceMatches] = useState<MapSearchResult[]>([]);
  const [isSearchingPlaces, setIsSearchingPlaces] = useState(false);
  const [isExportingPng, setIsExportingPng] = useState(false);
  // Bounding rects of global items in map-container px space (set via onMeasured callback).
  const globalRectsRef = useRef<Rect[]>([]);
  // Always points to the latest recomputeLayout closure so handleGlobalMeasured can call it.
  const recomputeLayoutRef = useRef<() => void>(() => {});
  const [layoutState, setLayoutState] = useState<{
    inputs: LayoutItemInput[];
    outputs: LayoutItemOutput[];
    leaderLines: LeaderLine[];
    metadata?: LayoutRunMetadata;
    viewport: { width: number; height: number } | null;
  }>({ inputs: [], outputs: [], leaderLines: [], viewport: null });
  const measureRootRef = useRef<HTMLDivElement | null>(null);
  
  const transformedData = useMemo<TransformedMapData>(() => {
    return transformAllCoordinates(geojson);
  }, [geojson]);

  const globalElements = styleCode?.Global || [];
  const routeStyles = styleCode?.Route || [];
  const pointStyles = styleCode?.Point || [];
  const labelStyles = styleCode?.Label || [];

  // 后端已返回处理好的步行路线，直接使用
  const displayLines = transformedData.lines;
  const effectiveMapDrag = draggable || mapTool === 'pan';

  const searchablePois = useMemo<MapSearchResult[]>(() => (
    transformedData.points.map((feature: any) => {
      const props = feature.properties || {};
      return {
        id: String(props.feature_id || props.name || props.label_title),
        source: 'trip' as const,
        name: props.name || props.label_title || '',
        day: props.day || '',
        description: props.label_script || props.description || props.label_extra_info || '',
        coordinates: feature.geometry?.coordinates as [number, number],
      };
    }).filter((item: any) => item.name && Array.isArray(item.coordinates))
  ), [transformedData.points]);

  const tripSearchMatches = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    return searchablePois.filter((item: any) => (
      `${item.name} ${item.description}`.toLowerCase().includes(query)
    )).slice(0, 6);
  }, [searchQuery, searchablePois]);

  const searchMatches = useMemo(() => {
    const merged = [...tripSearchMatches, ...mapLabelMatches, ...placeMatches];
    const seen = new Set<string>();
    return merged.filter((item) => {
      const key = `${item.source}:${item.name}:${item.coordinates.join(',')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 10);
  }, [tripSearchMatches, mapLabelMatches, placeMatches]);

  const getMapViewState = useMemo(() => {
    const dataForCalc: TransformedMapData = {
      ...transformedData,
      lines: displayLines
    };
    return calculateMapViewState(dataForCalc);
  }, [transformedData, displayLines]);

  const fitMapToContent = useCallback((duration = 700) => {
    const raw = mapRef.current as any;
    const map = raw?.getMap ? raw.getMap() : raw;
    if (!map || transformedData.points.length === 0) return;

    const coords = transformedData.points
      .map((feature: any) => feature.geometry?.coordinates)
      .filter((coord: any): coord is [number, number] => (
        Array.isArray(coord) &&
        typeof coord[0] === 'number' &&
        typeof coord[1] === 'number'
      ));
    if (coords.length === 0) return;

    const lons = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    const bounds: [[number, number], [number, number]] = [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ];

    const { width, height } = map.getContainer().getBoundingClientRect();
    if (!width || !height) return;

    const basePad = Math.round(Math.min(width, height) * 0.12);
    const padding = {
      top: basePad,
      bottom: basePad,
      left: basePad,
      right: basePad,
    };

    globalRectsRef.current.forEach((rect) => {
      const leftOverlap = Math.max(0, Math.min(rect.x + rect.width, width) - Math.max(rect.x, 0));
      const topOverlap = Math.max(0, Math.min(rect.y + rect.height, height) - Math.max(rect.y, 0));
      if (leftOverlap === 0 || topOverlap === 0) return;

      const centerX = rect.x + rect.width / 2;
      const centerY = rect.y + rect.height / 2;
      const extraX = Math.ceil(rect.width + 28);
      const extraY = Math.ceil(rect.height + 28);

      if (centerX < width / 2) padding.left = Math.max(padding.left, extraX);
      else padding.right = Math.max(padding.right, extraX);

      if (centerY < height / 2) padding.top = Math.max(padding.top, extraY);
      else padding.bottom = Math.max(padding.bottom, extraY);
    });

    map.fitBounds(bounds, {
      padding: {
        top: Math.min(Math.round(height * 0.42), padding.top),
        bottom: Math.min(Math.round(height * 0.42), padding.bottom),
        left: Math.min(Math.round(width * 0.42), padding.left),
        right: Math.min(Math.round(width * 0.42), padding.right),
      },
      duration,
    });
  }, [transformedData.points]);

  useEffect(() => {
    if (!isSearchOpen) return;
    searchInputRef.current?.focus();
  }, [isSearchOpen]);

  useEffect(() => {
    fitMapToContent(900);
  }, [fitMapToContent, mapFrameSize]);

  useEffect(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!mapLoaded || query.length < 2) {
      setMapLabelMatches([]);
      return;
    }
    const raw = mapRef.current as any;
    const map = raw?.getMap ? raw.getMap() : raw;
    if (!map?.queryRenderedFeatures) return;
    try {
      const features = map.queryRenderedFeatures();
      const next: MapSearchResult[] = [];
      const seen = new Set<string>();
      features.forEach((feature: any) => {
        if (next.length >= 5) return;
        const props = feature.properties || {};
        const name = props.name_zh || props.name_en || props.name || props.name_script || '';
        if (!name || !String(name).toLowerCase().includes(query)) return;
        const coordinates = feature.geometry?.coordinates;
        if (!Array.isArray(coordinates) || typeof coordinates[0] !== 'number' || typeof coordinates[1] !== 'number') return;
        const key = `${name}:${coordinates[0].toFixed(5)},${coordinates[1].toFixed(5)}`;
        if (seen.has(key)) return;
        seen.add(key);
        next.push({
          id: key,
          source: 'map',
          name: String(name),
          description: [props.class, props.type].filter(Boolean).join(' · '),
          coordinates: [coordinates[0], coordinates[1]],
        });
      });
      setMapLabelMatches(next);
    } catch {
      setMapLabelMatches([]);
    }
  }, [mapLoaded, searchQuery]);

  useEffect(() => {
    const query = searchQuery.trim();
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token || query.length < 2) {
      setPlaceMatches([]);
      setIsSearchingPlaces(false);
      return;
    }

    const abortController = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsSearchingPlaces(true);
      try {
        const raw = mapRef.current as any;
        const map = raw?.getMap ? raw.getMap() : raw;
        const center = map?.getCenter?.();
        const params = new URLSearchParams({
          q: query,
          access_token: token,
          limit: '5',
          language: 'zh,en',
        });
        if (center) params.set('proximity', `${center.lng},${center.lat}`);
        const response = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${params.toString()}`, {
          signal: abortController.signal,
        });
        if (!response.ok) throw new Error('geocoding failed');
        const data = await response.json();
        const next = (Array.isArray(data.features) ? data.features : [])
          .map((feature: any, index: number): MapSearchResult | null => {
            const coords = feature.geometry?.coordinates;
            if (!Array.isArray(coords) || typeof coords[0] !== 'number' || typeof coords[1] !== 'number') return null;
            const props = feature.properties || {};
            return {
              id: props.mapbox_id || feature.id || `place-${index}`,
              source: 'place',
              name: props.name || feature.text || feature.properties?.full_address || query,
              description: props.full_address || props.place_formatted || feature.place_name,
              coordinates: [coords[0], coords[1]],
            };
          })
          .filter(Boolean) as MapSearchResult[];
        setPlaceMatches(next);
      } catch (error: any) {
        if (error?.name !== 'AbortError') setPlaceMatches([]);
      } finally {
        setIsSearchingPlaces(false);
      }
    }, 320);

    return () => {
      window.clearTimeout(timer);
      abortController.abort();
    };
  }, [searchQuery]);

  const transformedLayers = {
    type: 'FeatureCollection',
    features: displayLines
  };
  const routeLayerIds = routeStyles.map((route: any) => `${route.visual_id}-line`);

  const mapStyle = useMemo(
    () => resolveMapStyle(visualStructure, showHeatmap),
    [visualStructure, showHeatmap],
  );

  const processLayoutInput = (
    id: string,
    feature: any,
    labelStyle: any,
    fallbackHierarchy: LayoutItemHierarchy = 'secondary',
    itemCount: number = 0,
  ) => {
    let positions = originPositions;
    if(currentDataset === 'layout'){
      positions = layoutPositions;
    }else if(currentDataset === 'groundtruth'){
      positions = groundtruthPositions;
      if(!positions) positions = layoutPositions;
    }
    const selectedPositions = positions ?? [];
    const [anchorLng, anchorLat] = feature.geometry.coordinates;
    const coord = feature.properties?.label_coord || feature.geometry.coordinates;
    const position = selectedPositions.find((item) => item.id === id) || {
      id,
      anchorLngLat: { lng: anchorLng, lat: anchorLat },
      centerLngLat: { lng: coord[0], lat: coord[1] },
    };
    const meta = getOverlayMeta(feature, labelStyle, fallbackHierarchy);
    const scale = getResponsiveOverlayScale(meta.hierarchy, viewportSize, itemCount || selectedPositions.length);
    return {
      ...position,
      kind: 'label',
      html: buildLabelHtml(feature, labelStyle),
      width: 0,
      height: 0,
      padding: meta.hierarchy === 'detail' ? 18 : 14,
      hierarchy: meta.hierarchy,
      contentType: meta.contentType,
      scale,
      hidden: shouldHideOverlay(meta.hierarchy, viewportSize, itemCount || selectedPositions.length),
    } as LayoutItemInput;
  }

  const buildLayoutInputs = useCallback((): LayoutItemInput[] => {
    const inputs: LayoutItemInput[] = [];
    const overlayCount = transformedData.points.filter((feature: any) => (
      feature.properties?.label_title || feature.properties?.name
    )).length;

    for (let i = 0; i < transformedData.points.length; i++) {
      const feature: any = transformedData.points[i];
      const labelStyle = selectLabelStyleForFeature(feature, labelStyles);
      if (!labelStyle) continue;
      if (!feature.properties?.label_title && !feature.properties?.name) continue;
      const id = getFeatureLabelId(feature, labelStyle);
      const input = processLayoutInput(id, feature, labelStyle, 'secondary', overlayCount);
      if(input) inputs.push(input);
    }
    console.log("inputs:", inputs);
    return inputs;
  }, [
    transformedData.points,
    currentDataset,
    originPositions,
    layoutPositions,
    groundtruthPositions,
    labelStyles,
    viewportSize,
  ]);

  // Called by GlobalRenderer after it measures its rendered children.
  // Converts viewport-space bounding rects to map-container-space and stores them.
  // Then triggers a layout recompute so global items are treated as obstacles.
  const handleGlobalMeasured = useCallback(
    (viewportRects: Array<{ x: number; y: number; width: number; height: number }>) => {
      const raw = mapRef.current as any;
      const map = raw?.getMap ? raw.getMap() : raw;
      if (!map) return;
      const containerBBox = map.getContainer().getBoundingClientRect();
      // Safety filter: exclude rects that are nearly full-screen in BOTH dimensions.
      // These are background overlay elements, not content panels we want to avoid.
      const maxW = containerBBox.width  * 0.7;
      const maxH = containerBBox.height * 0.7;
      const converted: Rect[] = viewportRects
        .map((r) => ({
          x: r.x - containerBBox.left,
          y: r.y - containerBBox.top,
          width: r.width,
          height: r.height,
        }))
        .filter((r) => r.width > 0 && r.height > 0 && !(r.width > maxW && r.height > maxH));
      globalRectsRef.current = converted;
      fitMapToContent(500);
      // Recompute layout with updated obstacles (via ref, always latest closure)
      recomputeLayoutRef.current();
    },
    [fitMapToContent]
  );

  useEffect(() => {
    // built layout inputs
    const next = buildLayoutInputs();
    setLayoutState((s) => {
      if (s.inputs.length !== next.length) {
        return { ...s, inputs: next, outputs: [], leaderLines: [] };
      }
      const same = s.inputs.every((it, i) => (
        it.id === next[i].id &&
        it.html === next[i].html &&
        it.scale === next[i].scale &&
        it.hidden === next[i].hidden &&
        it.hierarchy === next[i].hierarchy &&
        it.contentType === next[i].contentType
      ));
      if (same) {
        return s;
      }
      // Preserve already-measured width/height values when IDs change
      const merged = next.map(newItem => {
        const oldItem = s.inputs.find(it => it.id === newItem.id);
        if (oldItem && oldItem.html === newItem.html && oldItem.scale === newItem.scale && oldItem.width > 0 && oldItem.height > 0) {
          return { ...newItem, width: oldItem.width, height: oldItem.height };
        }
        return newItem;
      });
      return { ...s, inputs: merged, outputs: [], leaderLines: [] };
    });
  }, [buildLayoutInputs]);

  useEffect(() => {
    const root = measureRootRef.current;
    if (!root) return;
    if (layoutState.inputs.length === 0) return;

    // Give the browser more time to render HTML and apply styles
    const timer = setTimeout(() => {
      let changed = false;
      const measured = layoutState.inputs.map((it) => {
        if (it.width > 0 && it.height > 0) return it;
        const el = root.querySelector(
          `[data-layout-id="${CSS.escape(it.id)}"]`
        ) as HTMLElement | null;
        
        if (!el) {
          return it;
        }
        
        // Use scrollWidth/scrollHeight for content sizing
        const width = Math.ceil(el.scrollWidth);
        const height = Math.ceil(el.scrollHeight);
        
        if (width > 0 && height > 0) {
          changed = true;
          return { ...it, width, height };
        }
        
        // Fallback to getBoundingClientRect if scrollWidth/scrollHeight don't work
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          changed = true;
          return { ...it, width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
        }
        
        return it;
      });
      if (!changed) return;
      setLayoutState((s) => ({ ...s, inputs: measured }));
    }, 300);

    return () => clearTimeout(timer);
  }, [layoutState.inputs]);

  const recomputeLayout = useCallback(() => {
    const raw = mapRef.current as any;
    const map = raw?.getMap ? raw.getMap() : raw;
    if (!map) return;
    const container = map.getContainer();
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height) return;

    const viewport = { width, height };
    const project = (lng: number, lat: number) => map.project([lng, lat]);

    const pointsPx = transformedData.points.map((f: any) => {
      const [lng, lat] = f.geometry.coordinates;
      const p = project(lng, lat);
      return { x: p.x, y: p.y };
    });

    const linesPx = displayLines.map((f: any) =>
      (f.geometry.coordinates as number[][]).map(([lng, lat]) => {
        const p = project(lng, lat);
        return { x: p.x, y: p.y };
      })
    );

    // Point obstacles remain rect-based; lines use exact segment distances.
    const obstacles = buildObstacleRects(
      { pointsPx, linesPx: [], polygonsPx: [] },
      { pointRadius: 10, lineHalfWidth: 6, polygonHalfWidth: 0, lineSampleStep: 24 }
    );
    const segments = buildObstacleSegments({ linesPx, polygonsPx: [] });

    // Include global item rects in the cost field so the Gaussian repulsion field
    // pushes labels away from them during the simulation.
    const allObstacles = [...obstacles, ...globalRectsRef.current];

    const mergedField = { ...DEFAULT_FIELD, ...fieldParams };
    const field = buildCostFieldFromRects(allObstacles, {
      width: viewport.width,
      height: viewport.height,
      ...mergedField,
    }, segments);

    setDebugCostField(field);
    const visibleInputs = layoutState.inputs.filter((it) => !it.hidden);
    const ready = visibleInputs.map((it) => {
      // Use measured dimensions, fallback to conservative defaults if not yet measured
      const width = it.width > 0 ? it.width : 80;
      const height = it.height > 0 ? it.height : 32;
      const p = project(it.anchorLngLat.lng, it.anchorLngLat.lat);
      return {
        ...it,
        width,
        height,
        anchorPx: { x: p.x, y: p.y },
      };
    });

    const activeForceParams = { ...DEFAULT_FORCE, ...forceParams, seed: layoutSeed };
    const activeVoronoiForceParams = { ...DEFAULT_VORONOI_FORCE, seed: layoutSeed };
    const activeSimAnnealingParams = { ...DEFAULT_SIM_ANNEALING, seed: layoutSeed };
    const layoutContext = { viewport, costField: field, segments, globalRects: globalRectsRef.current };
    const layoutStartedAt = new Date().toISOString();
    const layoutStart = performance.now();
    let layoutResult: { outputs: LayoutItemOutput[]; leaderLines: LeaderLine[] };
    let initialization: LayoutRunMetadata['initialization'] = 'anchor';
    let pipeline: string[];
    let layoutParams: Record<string, unknown>;

    if (layoutAlgorithm === 'simulatedAnnealing') {
      layoutResult = runSimulatedAnnealingLayout(ready, layoutContext, activeSimAnnealingParams);
      pipeline = ['simulatedAnnealing'];
      layoutParams = activeSimAnnealingParams;
    } else if (layoutAlgorithm === 'weightedVoronoiDirect') {
      layoutResult = runVoronoiForceLayout(
        ready,
        layoutContext,
        DEFAULT_VORONOI,
        activeVoronoiForceParams
      );
      pipeline = ['weightedVoronoi', 'forceRefinement'];
      layoutParams = {
        voronoi: DEFAULT_VORONOI,
        forceRefinement: activeVoronoiForceParams,
      };
    } else if (layoutAlgorithm === 'weightedVoronoi') {
      const forceInitialization = runForceLayout(ready, layoutContext, activeForceParams);
      const forceInitializedInputs = forceInitialization.outputs.map((output) => ({
        ...output,
        prevCenter: { x: output.cx, y: output.cy },
      }));
      layoutResult = runVoronoiForceLayout(
        forceInitializedInputs,
        layoutContext,
        DEFAULT_VORONOI,
        activeVoronoiForceParams
      );
      initialization = 'force';
      pipeline = ['forceInitialization', 'weightedVoronoi', 'forceRefinement'];
      layoutParams = {
        forceInitializer: activeForceParams,
        voronoi: DEFAULT_VORONOI,
        forceRefinement: activeVoronoiForceParams,
      };
    } else {
      layoutResult = runForceLayout(ready, layoutContext, activeForceParams);
      pipeline = ['force'];
      layoutParams = activeForceParams;
    }

    const { outputs, leaderLines } = layoutResult;
    const runtimeMs = performance.now() - layoutStart;
    
    const outputsWithLngLat = outputs.map(o => {
      const lngLat = map.unproject([o.cx, o.cy]);
      return {
        ...o,
        centerLngLat: { lng: lngLat.lng, lat: lngLat.lat },
      };
    });

    const metadata: LayoutRunMetadata = {
      algorithm: layoutAlgorithm,
      seed: layoutSeed,
      initialization,
      pipeline,
      runtimeMs: Number(runtimeMs.toFixed(2)),
      itemCount: ready.length,
      viewport,
      generatedAt: layoutStartedAt,
      layoutParams,
      fieldParams: mergedField,
    };
    
    console.log("after layout outputs:", outputsWithLngLat);
    setLayoutState((s) => ({ ...s, viewport, outputs: outputsWithLngLat, leaderLines, metadata }));
  }, [displayLines, transformedData.points, forceParams, fieldParams, layoutState.inputs, rerunLayoutTrigger, layoutAlgorithm, layoutSeed]);

  // Keep recomputeLayoutRef always pointing to the latest closure.
  // handleGlobalMeasured calls this ref so it never captures a stale version.
  useEffect(() => {
    recomputeLayoutRef.current = recomputeLayout;
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const updateSize = () => {
      const rect = root.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      setViewportSize((prev) => {
        if (prev && Math.round(prev.width) === Math.round(rect.width) && Math.round(prev.height) === Math.round(rect.height)) {
          return prev;
        }
        return { width: rect.width, height: rect.height };
      });

      const raw = mapRef.current as any;
      const map = raw?.getMap ? raw.getMap() : raw;
      map?.resize?.();
      recomputeLayoutRef.current();
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(root);
    window.addEventListener('resize', updateSize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  useEffect(() => {
    if (layoutState.inputs.length === 0) return;
    recomputeLayout();
  }, [layoutState.inputs, recomputeLayout]);



  useEffect(() => {
    if (!currentDataset || layoutState.inputs.length === 0) return;
    const raw = mapRef.current as any;
    const map = raw?.getMap ? raw.getMap() : raw;
    if (!map) return;

    const project = (lng: number, lat: number) => map.project([lng, lat]);

    if (currentDataset === 'origin') {
      if (!originPositions || originPositions.length === 0) return;
      const posMap = new Map(originPositions.map(p => [p.id, p]));
      const displayOutputs = layoutState.outputs.map(output => {
        const pos = posMap.get(output.id);
        if (!pos) return null;
        const anchorPx = project(pos.anchorLngLat.lng, pos.anchorLngLat.lat);
        const centerPx = anchorPx;
        return {
          ...output,
          anchorPx,
          x: centerPx.x - output.width / 2,
          y: centerPx.y - output.height / 2,
          cx: centerPx.x,
          cy: centerPx.y,
          centerLngLat: pos.centerLngLat,
        };
      }).filter(Boolean) as LayoutItemOutput[];

      const displayLeaderLines = displayOutputs.map(o => ({
        id: o.id,
        x1: o.anchorPx.x,
        y1: o.anchorPx.y,
        x2: o.cx,
        y2: o.cy,
      }));
      setLayoutState(s => ({ ...s, outputs: displayOutputs, leaderLines: displayLeaderLines }));
      console.log("Origin display displayOutputs:", displayOutputs);
    } else if (currentDataset === 'layout') {
      recomputeLayout();
      console.log("Layout display displayOutputs:", layoutState.outputs);
    } else if (currentDataset === 'groundtruth') {
      recomputeLayout();
      console.log("Groundtruth display displayOutputs:", layoutState.outputs);
    }
  }, [currentDataset, originPositions, layoutPositions, groundtruthPositions]);


  useEffect(() => {
    if (layoutState.inputs.length === 0) return;
    recomputeLayout();
  }, [forceParams, fieldParams, rerunLayoutTrigger, layoutAlgorithm, layoutSeed]);

  useEffect(() => {
    if (layoutState.outputs.length > 0 && onLayoutOutput) {
      onLayoutOutput(layoutState.outputs, layoutState.inputs, layoutState.metadata);
    }
  }, [layoutState.outputs, layoutState.inputs, layoutState.metadata, onLayoutOutput]);

  const onMapLoad = useCallback(() => {
    const raw = mapRef.current as any;
    const map = raw?.getMap ? raw.getMap() : raw;
    setMapLoaded(true);
    if (map && onMapInfoChange) {
      const center = map.getCenter();
      const bounds = map.getBounds();
      onMapInfoChange({
        center: { lng: center.lng, lat: center.lat },
        bounds: { north: bounds.getNorth(), south: bounds.getSouth(), east: bounds.getEast(), west: bounds.getWest() },
      });
    }
    applyMapboxStylesheet(map, visualStructure);
    fitMapToContent(900);
    recomputeLayout();
  }, [fitMapToContent, recomputeLayout, onMapInfoChange, visualStructure]);

  const onStyleData = useCallback(() => {
    const raw = mapRef.current as any;
    const map = raw?.getMap ? raw.getMap() : raw;
    applyMapboxStylesheet(map, visualStructure);
  }, [visualStructure]);

  useEffect(() => {
    if (!mapLoaded) return;
    const timer = setTimeout(() => {
      const raw = mapRef.current as any;
      const map = raw?.getMap ? raw.getMap() : raw;
      applyMapboxStylesheet(map, visualStructure);
    }, 80);
    return () => clearTimeout(timer);
  }, [mapLoaded, mapStyle, visualStructure]);

  const onMoveEnd = useCallback(() => {
    const raw = mapRef.current as any;
    const map = raw?.getMap ? raw.getMap() : raw;
    if (map && onMapInfoChange) {
      const container = map.getContainer();
      const { width, height } = container.getBoundingClientRect();
      const topLeftLngLat = map.unproject([0, 0]);
      const bottomRightLngLat = map.unproject([width, height]);
      const correctMapInfo = {
        center: {
          lng: map.getCenter().lng,
          lat: map.getCenter().lat
        },
        bounds: {
          north: topLeftLngLat.lat,       // 左上角
          south: bottomRightLngLat.lat,   // 右下角
          east: bottomRightLngLat.lng,    // 右下角
          west: topLeftLngLat.lng        // 左上角
        }
      };
      console.log("全屏边界 mapInfo:", correctMapInfo);
      onMapInfoChange(correctMapInfo);
    }
    recomputeLayout();
    console.log("onMoveEnd:",layoutState.inputs, layoutState.outputs);
  }, [recomputeLayout, onMapInfoChange]);

  const onMapClick = useCallback((event: any) => {
    if (mapTool === 'pan') return;
    const feature = event.features?.find((item: any) => item.geometry?.type === 'LineString');
    if (feature?.properties?.visual_id) {
      onRouteSelect?.(feature.properties.visual_id);
      const routeStyle = routeStyles.find((route: any) => route.visual_id === feature.properties.visual_id);
      setSelectedAgentSelection({
        kind: 'map_feature',
        node_id: 'map_line',
        label: feature.properties?.name || feature.properties?.visual_id || 'Route',
        payload: {
          feature: {
            type: 'Feature',
            geometry: feature.geometry,
            properties: feature.properties,
          },
          routeStyle,
          geometryType: 'LineString',
        },
      });
    }
  }, [mapTool, onRouteSelect, routeStyles, setSelectedAgentSelection]);

  const selectMapFeature = useCallback((feature: any, kind: 'point' | 'label' | 'layout_label') => {
    const props = feature?.properties || {};
    const pointStyle = pointStyles.find((style: any) => style.visual_id === props.visual_id);
    const labelStyle = selectLabelStyleForFeature(feature, labelStyles);
    setSelectedAgentSelection({
      kind: 'map_feature',
      node_id: `map_${kind}`,
      label: props.name || props.label_title || props.visual_id || kind,
      payload: {
        feature,
        pointStyle,
        labelStyle,
        geometryType: feature?.geometry?.type,
      },
    });
  }, [labelStyles, pointStyles, setSelectedAgentSelection]);

  const selectLayoutOutput = useCallback((output: LayoutItemOutput) => {
    const feature = transformedData.points.find((item: any) => {
      const labelStyle = selectLabelStyleForFeature(item, labelStyles);
      return getFeatureLabelId(item, labelStyle) === output.id;
    });
    if (feature) {
      selectMapFeature(feature, 'layout_label');
    }
  }, [labelStyles, selectMapFeature, transformedData.points]);

  const exportViewportPng = useCallback(async () => {
    const root = rootRef.current;
    if (!root || isExportingPng) return;
    setIsExportingPng(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(root, {
        backgroundColor: null,
        useCORS: true,
        allowTaint: true,
        logging: false,
        ignoreElements: (element) => element.getAttribute('data-export-ignore') === 'true',
      });
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((nextBlob) => {
          if (nextBlob) resolve(nextBlob);
          else reject(new Error('Canvas export returned an empty image'));
        }, 'image/png');
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `mapbox_view_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      console.error('Export map PNG failed:', error);
      alert('Export PNG failed. Please try again after the map finishes rendering.');
    } finally {
      setIsExportingPng(false);
    }
  }, [isExportingPng]);

  const flyToSearchResult = useCallback((item: MapSearchResult) => {
    const raw = mapRef.current as any;
    const map = raw?.getMap ? raw.getMap() : raw;
    if (!map || !Array.isArray(item.coordinates)) return;
    map.flyTo({ center: item.coordinates, zoom: Math.max(map.getZoom(), 13), duration: 900 });
    setSearchQuery(item.name);
  }, []);

      
  // showHeatmap: standard map + line/point/polygon only, no label/global/background
  // normal/debug: all components
  const hideOverlays = showHeatmap;
  const projectFeatureToScreen = (feature: any) => {
    const raw = mapRef.current as any;
    const map = raw?.getMap ? raw.getMap() : raw;
    const coord = feature?.geometry?.coordinates;
    if (!map || !Array.isArray(coord)) return null;
    const point = map.project(coord);
    return { x: point.x, y: point.y };
  };

  const groundtruthLeaderLines = React.useMemo(() => {
    if (!mapRef.current || layoutState.outputs.length === 0) return [];
    const raw = mapRef.current as any;
    const map = raw?.getMap ? raw.getMap() : raw;
    if (!map) return [];

    return layoutState.outputs.map(o => {
      const gtItem = groundtruthPositions?.find(p => p.id === o.id);
      const effectivePos = gtItem ? gtItem.centerLngLat : null;

      const anchorPx = map.project([o.anchorLngLat.lng, o.anchorLngLat.lat]);
      let cx: number, cy: number;

      if (effectivePos) {
        const gtPx = map.project([effectivePos.lng, effectivePos.lat]);
        cx = gtPx.x;
        cy = gtPx.y;
      } else {
        cx = o.cx;
        cy = o.cy;
      }

      return {
        id: o.id,
        x1: anchorPx.x,
        y1: anchorPx.y,
        x2: cx,
        y2: cy,
      };
    });
  }, [layoutState.outputs, groundtruthPositions, mapRef]);

  const displayLeaderLines = currentDataset === 'groundtruth' && groundtruthLeaderLines.length > 0
    ? groundtruthLeaderLines
    : layoutState.leaderLines;
  const fallbackOverlayCount = transformedData.points.length;
  const fallbackLabelScale = getResponsiveOverlayScale('secondary', viewportSize, fallbackOverlayCount);
  const hideDetailLabels = shouldHideOverlay('detail', viewportSize, fallbackOverlayCount);
  const mapOverlayReady = mapLoaded && Boolean((mapRef.current as any)?.getMap ? (mapRef.current as any).getMap() : mapRef.current);
  const updateMapFrameSize = useCallback((updates: Partial<{ width: number; height: number }>) => {
    setMapFrameSize((prev) => ({
      width: Math.max(360, Math.min(2400, Math.round(updates.width ?? prev.width))),
      height: Math.max(280, Math.min(1800, Math.round(updates.height ?? prev.height))),
    }));
  }, []);

  return (
    <div className="relative h-full w-full overflow-auto bg-gray-100">
      <div className="absolute left-3 top-3 z-30 flex items-center gap-2 rounded-md border border-gray-200 bg-white/95 p-2 text-[11px] shadow-sm backdrop-blur" data-export-ignore="true">
        <label className="flex items-center gap-1 text-gray-600">
          W
          <input
            type="number"
            min={360}
            max={2400}
            step={20}
            value={mapFrameSize.width}
            onChange={(event) => updateMapFrameSize({ width: Number(event.target.value) })}
            className="h-7 w-16 rounded border border-gray-200 px-1.5 text-gray-800 outline-none"
          />
        </label>
        <label className="flex items-center gap-1 text-gray-600">
          H
          <input
            type="number"
            min={280}
            max={1800}
            step={20}
            value={mapFrameSize.height}
            onChange={(event) => updateMapFrameSize({ height: Number(event.target.value) })}
            className="h-7 w-16 rounded border border-gray-200 px-1.5 text-gray-800 outline-none"
          />
        </label>
        <button type="button" className="rounded border border-gray-200 px-2 py-1 text-gray-700 hover:bg-gray-50" onClick={() => updateMapFrameSize({ width: 1100, height: 720 })}>16:10</button>
        <button type="button" className="rounded border border-gray-200 px-2 py-1 text-gray-700 hover:bg-gray-50" onClick={() => updateMapFrameSize({ width: 900, height: 900 })}>1:1</button>
        <button type="button" className="rounded border border-gray-200 px-2 py-1 text-gray-700 hover:bg-gray-50" onClick={() => updateMapFrameSize({ width: 720, height: 1100 })}>9:14</button>
      </div>

      <div
        ref={rootRef}
        data-agent-map-frame="true"
        className="relative mx-auto my-12 overflow-hidden bg-white shadow-sm"
        style={{ width: mapFrameSize.width, height: mapFrameSize.height }}
      >
        <MapGL
          ref={mapRef}
          initialViewState={getMapViewState}
          mapStyle={mapStyle}
          mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
          style={{ width: '100%', height: '100%', zIndex: 1 }}
          onLoad={onMapLoad}
          onStyleData={onStyleData}
          onClick={onMapClick}
          onMoveEnd={onMoveEnd}
          interactiveLayerIds={routeLayerIds}
          scrollZoom={effectiveMapDrag}
          dragPan={effectiveMapDrag}
          dragRotate={effectiveMapDrag}
          keyboard={effectiveMapDrag}
          doubleClickZoom={effectiveMapDrag}
          preserveDrawingBuffer
        >
          <RouteRenderer routeStyles={routeStyles} transformedLayers={transformedLayers} selectedRouteId={selectedRouteId} />
          {mapOverlayReady && (
            <PointRenderer
              points={transformedData.points}
              pointStyles={pointStyles}
              globalProps={transformedData.globalProps}
              selectable={mapTool === 'select'}
              onFeatureSelect={selectMapFeature}
            />
          )}
          {mapOverlayReady && !hideOverlays && layoutState.outputs.length === 0 && (
            <LabelRenderer
              points={transformedData.points}
              labelStyles={labelStyles}
              globalProps={transformedData.globalProps}
              labelScale={fallbackLabelScale}
              hideDetailLabels={hideDetailLabels}
              selectable={mapTool === 'select'}
              onFeatureSelect={selectMapFeature}
            />
          )}
        </MapGL>

      <div data-export-ignore="true" className="absolute right-3 top-3 z-20 flex w-[260px] flex-col gap-2">
        <div className="agent-theme-map-toolbar flex items-center gap-1 rounded-md border p-1 shadow-sm backdrop-blur">
          <button
            type="button"
            title="Select map elements"
            onClick={() => setMapTool('select')}
            className={`grid h-8 w-8 place-items-center rounded ${mapTool === 'select' ? 'agent-theme-map-tool-active' : 'agent-theme-map-tool-idle'}`}
          >
            <MousePointer2Icon className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Pan map"
            onClick={() => setMapTool('pan')}
            className={`grid h-8 w-8 place-items-center rounded ${mapTool === 'pan' ? 'agent-theme-map-tool-active' : 'agent-theme-map-tool-idle'}`}
          >
            <HandIcon className="h-4 w-4" />
          </button>
          <div className="mx-1 h-5 w-px bg-gray-200" />
          <button
            type="button"
            title="Zoom in"
            onClick={() => {
              const raw = mapRef.current as any;
              const map = raw?.getMap ? raw.getMap() : raw;
              map?.zoomIn?.({ duration: 250 });
            }}
            className="agent-theme-map-tool-idle grid h-8 w-8 place-items-center rounded"
          >
            <ZoomInIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Zoom out"
            onClick={() => {
              const raw = mapRef.current as any;
              const map = raw?.getMap ? raw.getMap() : raw;
              map?.zoomOut?.({ duration: 250 });
            }}
            className="agent-theme-map-tool-idle grid h-8 w-8 place-items-center rounded"
          >
            <ZoomOutIcon className="h-4 w-4" />
          </button>
          <div className="mx-1 h-5 w-px bg-gray-200" />
          <button
            type="button"
            title="Export current map view as PNG"
            onClick={exportViewportPng}
            disabled={isExportingPng}
            className="agent-theme-map-tool-idle grid h-8 w-8 place-items-center rounded disabled:opacity-50"
          >
            <DownloadIcon className={`h-4 w-4 ${isExportingPng ? 'animate-pulse' : ''}`} />
          </button>
          <div className="mx-1 h-5 w-px bg-gray-200" />
          <button
            type="button"
            title="Search map or trip"
            onClick={() => setIsSearchOpen((open) => !open)}
            className={`grid h-8 w-8 place-items-center rounded ${isSearchOpen ? 'agent-theme-map-tool-active' : 'agent-theme-map-tool-idle'}`}
          >
            <SearchIcon className="h-4 w-4" />
          </button>
        </div>

        {isSearchOpen && (
          <div className="agent-theme-map-toolbar rounded-md border shadow-sm backdrop-blur">
            <div className="flex items-center gap-2 px-2 py-1.5">
              <SearchIcon className="h-4 w-4 flex-none text-gray-500" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search map or trip"
                className="min-w-0 flex-1 bg-transparent text-xs outline-none"
              />
            </div>
            {(searchMatches.length > 0 || isSearchingPlaces) && (
              <div className="max-h-44 overflow-y-auto border-t border-gray-100 py-1">
                {searchMatches.map((item: MapSearchResult) => (
                  <button
                    key={`${item.source}-${item.id}`}
                    type="button"
                    onClick={() => flyToSearchResult(item)}
                    className="block w-full px-2 py-1.5 text-left hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-1">
                      <span className="rounded bg-gray-100 px-1 py-0.5 text-[9px] uppercase text-gray-500">{item.source}</span>
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-800">{item.name}</span>
                    </div>
                    <div className="truncate text-[10px] text-gray-500">{item.description || 'Map location'}</div>
                  </button>
                ))}
                {isSearchingPlaces && (
                  <div className="px-2 py-1 text-[10px] text-gray-500">Searching map...</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Cost field heat map overlay */}
      {showHeatmap && <DebugOverlay costField={debugCostField} />}

      {!hideOverlays && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 5,
            pointerEvents: 'none',
          }}
        >
          <svg
            width="100%"
            height="100%"
            style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
          >
            {displayLeaderLines.map((l) => (
              <line
                key={`leader-${l.id}`}
                x1={l.x1}
                y1={l.y1}
                x2={l.x2}
                y2={l.y2}
                stroke="rgba(0,0,0,0.45)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            ))}
          </svg>

          {layoutState.outputs.map((o) => {
            const gtItem = groundtruthPositions?.find(p => p.id === o.id);
            const effectivePos = gtItem ? gtItem.centerLngLat : null;
            const groundtruthPx = effectivePos ? { lng: effectivePos.lng, lat: effectivePos.lat } : undefined;

            return (
              <DraggableOutput
                key={o.id}
                outputPosition={o}
                enabled={currentDataset === 'groundtruth'}
                mapRef={mapRef}
                onPositionChange={(id, lng, lat) => {
                  console.log("position change:", id, lng, lat);
                  onGroundtruthChange?.({ [id]: { lng, lat } });
                }}
                overridePosition={groundtruthPx}
                selectable={mapTool === 'select'}
                onSelect={selectLayoutOutput}
              />
            );
          })}
          {mapTool === 'select' && transformedData.points.map((feature: any, index: number) => {
            const point = projectFeatureToScreen(feature);
            if (!point) return null;
            const props = feature.properties || {};
            return (
              <button
                key={[
                  'point-hit',
                  props.feature_id,
                  props.visual_id,
                  props.day,
                  props.order,
                  props.name || props.label_title,
                  index,
                ].filter(Boolean).join('-')}
                type="button"
                aria-label={`Select ${props.name || props.label_title || 'POI'}`}
                className="map-feature-click-target"
                data-map-feature-kind="point_hit"
                onClick={(event) => {
                  event.stopPropagation();
                  selectMapFeature(feature, 'point');
                }}
                style={{
                  position: 'absolute',
                  left: `${point.x - 10}px`,
                  top: `${point.y - 10}px`,
                  width: 20,
                  height: 20,
                  border: 0,
                  padding: 0,
                  background: 'transparent',
                  pointerEvents: 'auto',
                  cursor: 'pointer',
                  zIndex: 20,
                }}
              />
            );
          })}
        </div>
      )}

      {/* Off-screen measurement sandbox.
          For position: absolute children, we need a large visible container
          so the browser can calculate their dimensions. */}
      <div
        ref={measureRootRef}
        style={{
          position: 'fixed',
          visibility: 'hidden',
          pointerEvents: 'none',
          zIndex: -1,
          width: '2000px',
          height: '2000px',
          display: 'block',
        }}
      >
        {layoutState.inputs.map((it) => (
          <div
            key={`measure-${it.id}`}
            data-layout-id={it.id}
            style={{ 
              position: 'relative',
              display: 'inline-block',
              width: 'auto',
              height: 'auto',
              '--map-label-scale': it.scale ?? 1,
            } as React.CSSProperties}
            dangerouslySetInnerHTML={{ __html: it.html }}
          />
        ))}
      </div>

      {!hideOverlays && (
        <GlobalRenderer
          globalElements={globalElements}
          globalProps={transformedData.globalProps}
          viewportSize={viewportSize}
          onMeasured={handleGlobalMeasured}
        />
      )}
    </div>
    </div>
  );
}
