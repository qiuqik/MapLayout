'use client';
import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import MapGL, { MapRef } from 'react-map-gl/mapbox';
import { HandIcon, MousePointer2Icon, SearchIcon, ZoomInIcon, ZoomOutIcon } from 'lucide-react';
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
  const styleLayerIds = new Set((map.getStyle?.().layers || []).map((layer: any) => layer.id));

  stylesheet.layers.forEach((entry: any) => {
    if (!entry?.target || !entry.paint || typeof entry.paint !== 'object') return;
    const mappedLayerIds = MAPBOX_LAYER_TARGETS[entry.target] || [];
    const layerIds = [
      entry.target,
      ...mappedLayerIds,
    ].filter((layerId, index, all) => all.indexOf(layerId) === index && styleLayerIds.has(layerId));
    if (layerIds.length === 0) {
      console.warn(`[Stylesheet] No Mapbox layer matched target "${entry.target}"`);
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapRef>(null);
  const [debugCostField, setDebugCostField] = useState<CostField | null>(null);
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number } | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapTool, setMapTool] = useState<'select' | 'pan'>('select');
  const [searchQuery, setSearchQuery] = useState('');
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

  const searchablePois = useMemo(() => (
    transformedData.points.map((feature: any) => {
      const props = feature.properties || {};
      return {
        id: props.feature_id || props.name || props.label_title,
        name: props.name || props.label_title || '',
        day: props.day || '',
        description: props.label_script || props.description || props.label_extra_info || '',
        coordinates: feature.geometry?.coordinates,
      };
    }).filter((item: any) => item.name && Array.isArray(item.coordinates))
  ), [transformedData.points]);

  const searchMatches = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    return searchablePois.filter((item: any) => (
      `${item.name} ${item.day} ${item.description}`.toLowerCase().includes(query)
    )).slice(0, 6);
  }, [searchQuery, searchablePois]);

  const getMapViewState = useMemo(() => {
    const dataForCalc: TransformedMapData = {
      ...transformedData,
      lines: displayLines
    };
    return calculateMapViewState(dataForCalc);
  }, [transformedData, displayLines]);

  useEffect(() => {
    // Fit map view to data
    if (mapRef.current && (transformedData.points.length > 0 || displayLines.length > 0)) {
      const coords: number[][] = [];
      
      transformedData.points.forEach((feature: any) => {
        coords.push(feature.geometry.coordinates);
      });
      
      displayLines.forEach((feature: any) => {
        feature.geometry.coordinates.forEach((coord: number[]) => {
          coords.push(coord);
        });
      });
      
      if (coords.length > 0) {
        const lons = coords.map((c) => c[0]);
        const lats = coords.map((c) => c[1]);
        const bounds: [[number, number], [number, number]] = [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ];

        // Target: route occupies ~60% of the canvas on both axes.
        // → 20% padding on each side horizontally, 20% on each side vertically.
        // Global components (title panel, overview card) typically sit at the top,
        // so shift the vertical center downward by adding extra top padding and
        // subtracting the same amount from the bottom, keeping total vPad constant.
        const raw = mapRef.current as any;
        const mapInstance = raw?.getMap ? raw.getMap() : raw;
        const { width, height } = mapInstance.getContainer().getBoundingClientRect();

        const hPad = Math.round(width * 0.20);          // 20% each side → 60% horizontal
        const vPadBase = Math.round(height * 0.20);     // 20% each side → 60% vertical
        const globalOffset = Math.round(height * 0.08); // extra top bias for global components

        mapRef.current.fitBounds(bounds, {
          padding: {
            top:    vPadBase + globalOffset,
            bottom: Math.max(20, vPadBase - globalOffset),
            left:   hPad,
            right:  hPad,
          },
          duration: 1500,
        });
      }
    }
  }, [transformedData, displayLines]);

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
      // Recompute layout with updated obstacles (via ref, always latest closure)
      recomputeLayoutRef.current();
    },
    []
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
    // pushes labels/cards away from them during the simulation.
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
    recomputeLayout();
  }, [recomputeLayout, onMapInfoChange, visualStructure]);

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
    }
  }, [mapTool, onRouteSelect]);

  const flyToSearchResult = useCallback((item: any) => {
    const raw = mapRef.current as any;
    const map = raw?.getMap ? raw.getMap() : raw;
    if (!map || !Array.isArray(item.coordinates)) return;
    map.flyTo({ center: item.coordinates, zoom: Math.max(map.getZoom(), 13), duration: 900 });
    setSearchQuery(item.name);
  }, []);

      
  // showHeatmap: standard map + line/point/polygon only, no label/card/global/background
  // normal/debug: all components
  const hideOverlays = showHeatmap;

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

  return (
    <div ref={rootRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
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
      >
        <RouteRenderer routeStyles={routeStyles} transformedLayers={transformedLayers} selectedRouteId={selectedRouteId} />
        <PointRenderer points={transformedData.points} pointStyles={pointStyles} globalProps={transformedData.globalProps} />
        {!hideOverlays && layoutState.outputs.length === 0 && (
          <LabelRenderer
            points={transformedData.points}
            labelStyles={labelStyles}
            globalProps={transformedData.globalProps}
            labelScale={fallbackLabelScale}
            hideDetailLabels={hideDetailLabels}
          />
        )}
      </MapGL>

      <div className="absolute right-3 top-3 z-20 flex w-[260px] flex-col gap-2">
        <div className="flex items-center gap-1 rounded-md border border-gray-200 bg-white/95 p-1 shadow-sm backdrop-blur">
          <button
            type="button"
            title="Select map elements"
            onClick={() => setMapTool('select')}
            className={`grid h-8 w-8 place-items-center rounded ${mapTool === 'select' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            <MousePointer2Icon className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Pan map"
            onClick={() => setMapTool('pan')}
            className={`grid h-8 w-8 place-items-center rounded ${mapTool === 'pan' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'}`}
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
            className="grid h-8 w-8 place-items-center rounded text-gray-700 hover:bg-gray-100"
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
            className="grid h-8 w-8 place-items-center rounded text-gray-700 hover:bg-gray-100"
          >
            <ZoomOutIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="rounded-md border border-gray-200 bg-white/95 shadow-sm backdrop-blur">
          <div className="flex items-center gap-2 px-2 py-1.5">
            <SearchIcon className="h-4 w-4 flex-none text-gray-500" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search trip POI"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none"
            />
          </div>
          {searchMatches.length > 0 && (
            <div className="max-h-44 overflow-y-auto border-t border-gray-100 py-1">
              {searchMatches.map((item: any) => (
                <button
                  key={`${item.id}-${item.day}`}
                  type="button"
                  onClick={() => flyToSearchResult(item)}
                  className="block w-full px-2 py-1.5 text-left hover:bg-gray-50"
                >
                  <div className="truncate text-xs font-semibold text-gray-800">{item.name}</div>
                  <div className="truncate text-[10px] text-gray-500">{[item.day, item.description].filter(Boolean).join(' · ')}</div>
                </button>
              ))}
            </div>
          )}
        </div>
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
          onMeasured={handleGlobalMeasured}
        />
      )}
    </div>
  );
}
