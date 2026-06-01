'use client';
import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import MapGL, { MapRef } from 'react-map-gl/mapbox';
import { StyleSpecification } from 'mapbox-gl';
// @ts-ignore
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  transformAllCoordinates,
  calculateMapViewState,
  TransformedMapData,
  populateTemplate
} from './utils/mapUtils';
import BaseMapRenderer from './renderers/BaseMapRenderer';
import GlobalRenderer from './renderers/GlobalRenderer';
import AreaRenderer from './renderers/AreaRenderer';
import RouteRenderer from './renderers/RouteRenderer';
import PointRenderer from './renderers/PointRenderer';
import CardRenderer from './renderers/CardRenderer';
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
  return contentTypeAliases[String(value ?? '').trim()] ?? fallback;
}

function getOverlayMeta(feature: any, style: any, fallbackHierarchy: LayoutItemHierarchy = 'secondary') {
  const hierarchy = normalizeHierarchy(
    feature?.properties?.label_hierarchy ?? feature?.properties?.hierarchy ?? style?.hierarchy ?? style?.label_hierarchy,
    fallbackHierarchy,
  );
  const contentType = normalizeContentType(
    feature?.properties?.label_content_type ?? feature?.properties?.content_type ?? style?.content_type ?? style?.label_content_type,
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

interface TravelMapProps {
  geojson: any;
  styleCode: any;
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
  rerunLayoutTrigger?: number;
  layoutAlgorithm?: 'force' | 'simulatedAnnealing' | 'weightedVoronoiDirect' | 'weightedVoronoi';
  layoutSeed?: number;
}

export default function TravelMap({ geojson, styleCode, showHeatmap = false, forceParams, fieldParams, draggable = false, currentDataset = 'layout', originPositions, layoutPositions, groundtruthPositions, onLayoutOutput, onGroundtruthChange, onMapInfoChange, rerunLayoutTrigger = 0, layoutAlgorithm = 'force', layoutSeed = 1 }: TravelMapProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapRef>(null);
  const [debugCostField, setDebugCostField] = useState<CostField | null>(null);
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number } | null>(null);
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
  const baseMapStyle = styleCode?.BaseMap?.[0];
  const routeStyles = styleCode?.Route || [];
  const areaStyles = styleCode?.Area || [];
  const pointStyles = styleCode?.Point || [];
  const cardStyles = styleCode?.Card || [];
  const labelStyles = styleCode?.Label || [];

  // 后端已返回处理好的步行路线，直接使用
  const displayLines = transformedData.lines;

  const getMapViewState = useMemo(() => {
    const dataForCalc: TransformedMapData = {
      ...transformedData,
      lines: displayLines
    };
    return calculateMapViewState(dataForCalc);
  }, [transformedData, displayLines]);

  useEffect(() => {
    // Fit map view to data
    if (mapRef.current && (transformedData.points.length > 0 || displayLines.length > 0 || transformedData.polygons.length > 0)) {
      const coords: number[][] = [];
      
      transformedData.points.forEach((feature: any) => {
        coords.push(feature.geometry.coordinates);
      });
      
      displayLines.forEach((feature: any) => {
        feature.geometry.coordinates.forEach((coord: number[]) => {
          coords.push(coord);
        });
      });
      
      transformedData.polygons.forEach((feature: any) => {
        feature.geometry.coordinates.forEach((ring: number[][]) => {
          ring.forEach((coord: number[]) => {
            coords.push(coord);
          });
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
    features: [...displayLines, ...transformedData.polygons]
  };

  const blankMapStyle: StyleSpecification = {
    version: 8,
    name: 'Blank',
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: {
          'background-color': 'transparent'
        }
      }
    ],
    glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
    sprite: 'mapbox://sprites/mapbox/streets-v12'
  };

  const mapStyle = showHeatmap
    ? 'mapbox://sprites/mapbox/streets-v12'
    // ? 'mapbox://styles/mapbox/light-v11'
    : baseMapStyle?.type === 'blank'
      ? blankMapStyle
      : baseMapStyle?.type === 'satellite'
        ? 'mapbox://styles/mapbox/satellite-v9'
        : 'mapbox://styles/mapbox/streets-v12';

  const processLayoutInput = (
    id: string,
    feature: any,
    globalProps: any,
    visualId: string,
    styles: any[],
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
    const input = [];
    for(let i = 0; i < selectedPositions.length; i++){
      const position = selectedPositions[i];
      if(position.id !== id) continue;
      const style = styles.find((l: any) => l.visual_id === visualId);
      if(style) {
        const html = populateTemplate(style.template, feature.properties, globalProps);
        const meta = getOverlayMeta(feature, style, fallbackHierarchy);
        const scale = getResponsiveOverlayScale(meta.hierarchy, viewportSize, itemCount || selectedPositions.length);
        input.push({
          ...position,
          kind: 'label',
          html,
          width: 0,
          height: 0,
          padding: meta.hierarchy === 'detail' ? 18 : 14,
          hierarchy: meta.hierarchy,
          contentType: meta.contentType,
          scale,
          hidden: shouldHideOverlay(meta.hierarchy, viewportSize, itemCount || selectedPositions.length),
        })
      }
    }
    if(input.length === 0) return null;
    return input;
  }

  const buildLayoutInputs = useCallback((): LayoutItemInput[] => {
    const inputs: LayoutItemInput[] = [];
    const globalProps = transformedData.globalProps;
    const allTransformedFeatures = [...transformedData.points,...transformedData.lines, ...transformedData.polygons];
    const overlayCount = allTransformedFeatures.reduce((count: number, feature: any) => {
      return count + (feature.properties?.card_coord ? 1 : 0) + (feature.properties?.label_coord ? 1 : 0);
    }, 0);

    for (let i = 0; i < allTransformedFeatures.length; i++) {
      const feature: any = allTransformedFeatures[i];
      const name = feature.properties?.name;
      const type = feature.geometry.type;
      if(feature.properties?.card_coord){
        const cardVisualId = feature.properties?.card_visual_id;
        const id = `card-${type}-${name}-${cardVisualId}`;
        // console.log("card id:", id);
        const input = processLayoutInput(id, feature, globalProps, cardVisualId, cardStyles, 'detail', overlayCount);
        if(input) inputs.push(...input);
      }
      if(feature.properties?.label_coord){
        const labelVisualId = feature.properties?.label_visual_id;
        const id = `label-${type}-${name}-${labelVisualId}`;
        // console.log("label id:", id);
        const input = processLayoutInput(id, feature, globalProps, labelVisualId, labelStyles, 'secondary', overlayCount);
        if(input) inputs.push(...input);
      }
    }
    console.log("inputs:", inputs);
    return inputs;
  }, [
    transformedData.points,
    transformedData.lines,
    transformedData.polygons,
    transformedData.globalProps,
    currentDataset,
    originPositions,
    layoutPositions,
    groundtruthPositions,
    labelStyles,
    cardStyles,
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

    const polygonsPx = transformedData.polygons.map((f: any) =>
      (f.geometry.coordinates as number[][][]).map((ring) =>
        ring.map(([lng, lat]) => {
          const p = project(lng, lat);
          return { x: p.x, y: p.y };
        })
      )
    );

    // Point obstacles remain rect-based; lines/polygons use exact segment distances.
    const obstacles = buildObstacleRects(
      { pointsPx, linesPx: [], polygonsPx: [] },
      { pointRadius: 10, lineHalfWidth: 6, polygonHalfWidth: 6, lineSampleStep: 24 }
    );
    const segments = buildObstacleSegments({ linesPx, polygonsPx });

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
  }, [displayLines, transformedData.points, transformedData.polygons, forceParams, fieldParams, layoutState.inputs, rerunLayoutTrigger, layoutAlgorithm, layoutSeed]);

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
    if (map && onMapInfoChange) {
      const center = map.getCenter();
      const bounds = map.getBounds();
      onMapInfoChange({
        center: { lng: center.lng, lat: center.lat },
        bounds: { north: bounds.getNorth(), south: bounds.getSouth(), east: bounds.getEast(), west: bounds.getWest() },
      });
    }
    recomputeLayout();
  }, [recomputeLayout, onMapInfoChange]);

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
  const fallbackOverlayCount = transformedData.points.length + transformedData.polygons.length;
  const fallbackLabelScale = getResponsiveOverlayScale('secondary', viewportSize, fallbackOverlayCount);
  const hideDetailLabels = shouldHideOverlay('detail', viewportSize, fallbackOverlayCount);

  return (
    <div ref={rootRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      {!hideOverlays && <BaseMapRenderer baseMapStyle={baseMapStyle} />}

      <MapGL
        ref={mapRef}
        initialViewState={getMapViewState}
        mapStyle={mapStyle}
        mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
        style={{ width: '100%', height: '100%', zIndex: 1 }}
        onLoad={onMapLoad}
        onMoveEnd={onMoveEnd}
        scrollZoom={draggable}
        dragPan={draggable}
        dragRotate={draggable}
        keyboard={draggable}
        doubleClickZoom={draggable}
      >
        <AreaRenderer areaStyles={areaStyles} transformedLayers={transformedLayers} />
        <RouteRenderer routeStyles={routeStyles} transformedLayers={transformedLayers} />
        <PointRenderer points={transformedData.points} pointStyles={pointStyles} globalProps={transformedData.globalProps} />
        {!hideOverlays && layoutState.outputs.length === 0 && (
          <>
            <CardRenderer
              points={transformedData.points}
              polygons={transformedData.polygons}
              cardStyles={cardStyles}
              globalProps={transformedData.globalProps}
              labelScale={fallbackLabelScale}
              hideDetailLabels={hideDetailLabels}
            />
            <LabelRenderer
              points={transformedData.points}
              labelStyles={labelStyles}
              globalProps={transformedData.globalProps}
              labelScale={fallbackLabelScale}
              hideDetailLabels={hideDetailLabels}
            />
          </>
        )}
      </MapGL>

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
