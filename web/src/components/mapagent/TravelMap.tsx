'use client';
import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import MapGL, { MapRef } from 'react-map-gl/mapbox';
import { DownloadIcon, HandIcon, Maximize2Icon, MousePointer2Icon, SearchIcon, SparklesIcon, ZoomInIcon, ZoomOutIcon } from 'lucide-react';
// @ts-ignore
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  transformAllCoordinates,
  calculateMapViewState,
  TransformedMapData,
  buildLabelHtml,
  getFeatureLabelId,
  resolveLeaderLineStyle,
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
import { API_BASE_URL } from '@/lib/api';

type MapSearchResult = {
  id: string;
  source: 'trip' | 'map' | 'place';
  name: string;
  description?: string;
  coordinates: [number, number];
};

type FrameResizeEdge = 'left' | 'right' | 'top' | 'bottom';

type NavigationRouteStatus = {
  state: 'idle' | 'loading' | 'mapbox' | 'fallback' | 'error';
  source?: string;
  warning?: string;
  error?: string;
};

const MIN_FRAME_WIDTH = 360;
const MIN_FRAME_HEIGHT = 280;

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

const routeStyleAliases: Record<string, 'straight' | 'bezier' | 'navigation'> = {
  straight: 'straight',
  line: 'straight',
  direct: 'straight',
  bezier: 'bezier',
  navigation: 'navigation',
  '直线': 'straight',
  '贝塞尔': 'bezier',
  '曲线': 'bezier',
  '导航': 'navigation',
  '导航路线': 'navigation',
};

const normalizeRouteRenderStyle = (value: unknown): 'straight' | 'bezier' | 'navigation' => {
  const key = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
  return routeStyleAliases[key] ?? 'bezier';
};

const routeCoordinateKey = (coordinates: unknown) => (
  Array.isArray(coordinates)
    ? coordinates
        .map((coord: any) => Array.isArray(coord) ? `${Number(coord[0]).toFixed(5)},${Number(coord[1]).toFixed(5)}` : '')
        .join('|')
    : ''
);

function initialMapFrameSize() {
  if (typeof window === 'undefined') return { width: 900, height: 640 };
  return {
    width: Math.max(MIN_FRAME_WIDTH, window.innerWidth),
    height: Math.max(MIN_FRAME_HEIGHT, window.innerHeight),
  };
}

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

function getViewportVisualScale(viewport: { width: number; height: number } | null) {
  const width = viewport?.width || 1100;
  const height = viewport?.height || 720;
  const scale = Math.min(width / 1100, height / 720);
  return Number(Math.max(0.58, Math.min(1.15, scale)).toFixed(3));
}

const waitForAnimationFrames = (count = 1) => new Promise<void>((resolve) => {
  const step = (remaining: number) => {
    if (remaining <= 0) {
      resolve();
      return;
    }
    window.requestAnimationFrame(() => step(remaining - 1));
  };
  step(count);
});

const waitForMapIdle = (map: any, timeoutMs = 1600) => new Promise<void>((resolve) => {
  if (!map?.once) {
    resolve();
    return;
  }

  let settled = false;
  let timer: number | undefined;
  const finish = () => {
    if (settled) return;
    settled = true;
    if (timer !== undefined) window.clearTimeout(timer);
    resolve();
  };
  timer = window.setTimeout(finish, timeoutMs);

  if (map.loaded?.() && !map.isMoving?.()) {
    finish();
    return;
  }
  map.once('idle', finish);
});

const captureMapCamera = (map: any) => {
  if (!map) return null;
  const center = map.getCenter?.();
  return {
    center: center ? [center.lng, center.lat] as [number, number] : undefined,
    zoom: map.getZoom?.(),
    bearing: map.getBearing?.(),
    pitch: map.getPitch?.(),
    padding: map.getPadding?.(),
  };
};

const restoreMapCamera = (map: any, camera: ReturnType<typeof captureMapCamera>) => {
  if (!map || !camera?.center) return;
  map.jumpTo?.({
    center: camera.center,
    zoom: camera.zoom,
    bearing: camera.bearing,
    pitch: camera.pitch,
    padding: camera.padding,
  });
};

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || new Error('Failed to read blob'));
  reader.readAsDataURL(blob);
});

const composeViewportPngBlob = async (root: HTMLElement, map: any, mapCanvas: HTMLCanvasElement) => {
  const camera = captureMapCamera(map);
  const rect = root.getBoundingClientRect();
  const canvasRect = mapCanvas.getBoundingClientRect();
  const canvasLeft = canvasRect.left - rect.left;
  const canvasTop = canvasRect.top - rect.top;
  const exportWidth = Math.max(1, Math.round(rect.width));
  const exportHeight = Math.max(1, Math.round(rect.height));

  await waitForAnimationFrames(2);
  await waitForMapIdle(map);
  restoreMapCamera(map, camera);
  await waitForAnimationFrames(1);
  await (document as any).fonts?.ready?.catch?.(() => undefined);
  restoreMapCamera(map, camera);
  await waitForAnimationFrames(1);

  const html2canvas = (await import('html2canvas')).default;
  const scale = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const output = document.createElement('canvas');
  output.width = Math.round(exportWidth * scale);
  output.height = Math.round(exportHeight * scale);
  const context = output.getContext('2d');
  if (!context) throw new Error('Canvas export context unavailable');
  context.scale(scale, scale);
  context.drawImage(
    mapCanvas,
    0,
    0,
    mapCanvas.width,
    mapCanvas.height,
    canvasLeft,
    canvasTop,
    canvasRect.width,
    canvasRect.height,
  );

  const overlayCanvas = await html2canvas(root, {
    backgroundColor: null,
    useCORS: true,
    allowTaint: true,
    logging: false,
    scale,
    width: exportWidth,
    height: exportHeight,
    windowWidth: document.documentElement.clientWidth,
    windowHeight: document.documentElement.clientHeight,
    ignoreElements: (element) => (
      element.getAttribute('data-export-ignore') === 'true' ||
      element instanceof HTMLCanvasElement
    ),
    onclone: (documentClone) => {
      const clonedRoot = documentClone.querySelector('[data-agent-map-frame="true"]') as HTMLElement | null;
      if (clonedRoot) {
        clonedRoot.style.width = `${exportWidth}px`;
        clonedRoot.style.height = `${exportHeight}px`;
        clonedRoot.style.background = 'transparent';
        clonedRoot.style.boxShadow = 'none';
      }
    },
  });
  context.drawImage(overlayCanvas, 0, 0, exportWidth, exportHeight);
  return new Promise<Blob>((resolve, reject) => {
    output.toBlob((nextBlob) => {
      if (nextBlob) resolve(nextBlob);
      else reject(new Error('Canvas export returned an empty image'));
    }, 'image/png');
  });
};

const lineRectEdgePoint = (
  start: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number },
) => {
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const dx = center.x - start.x;
  const dy = center.y - start.y;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return center;
  const halfWidth = rect.width / 2;
  const halfHeight = rect.height / 2;
  const scale = Math.min(
    Math.abs(dx) > 0.001 ? halfWidth / Math.abs(dx) : Number.POSITIVE_INFINITY,
    Math.abs(dy) > 0.001 ? halfHeight / Math.abs(dy) : Number.POSITIVE_INFINITY,
  );
  return {
    x: center.x - dx * scale,
    y: center.y - dy * scale,
  };
};

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

const expandRect = (rect: Rect, amount: number): Rect => ({
  x: rect.x - amount,
  y: rect.y - amount,
  width: rect.width + amount * 2,
  height: rect.height + amount * 2,
});

const rectsOverlap = (a: Rect, b: Rect, padding = 0) => {
  const expandedB = expandRect(b, padding);
  return (
    a.x < expandedB.x + expandedB.width &&
    a.x + a.width > expandedB.x &&
    a.y < expandedB.y + expandedB.height &&
    a.y + a.height > expandedB.y
  );
};

const pointInRect = (point: { x: number; y: number }, rect: Rect) => (
  point.x >= rect.x &&
  point.x <= rect.x + rect.width &&
  point.y >= rect.y &&
  point.y <= rect.y + rect.height
);

const lineSegmentsIntersect = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
) => {
  const epsilon = 1e-6;
  const cross = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) => (
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  );
  const orientation = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) => {
    const value = cross(p, q, r);
    if (Math.abs(value) <= epsilon) return 0;
    return value > 0 ? 1 : -1;
  };
  const onSegment = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) => (
    q.x <= Math.max(p.x, r.x) + epsilon &&
    q.x + epsilon >= Math.min(p.x, r.x) &&
    q.y <= Math.max(p.y, r.y) + epsilon &&
    q.y + epsilon >= Math.min(p.y, r.y)
  );
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a, c, b)) return true;
  if (o2 === 0 && onSegment(a, d, b)) return true;
  if (o3 === 0 && onSegment(c, a, d)) return true;
  if (o4 === 0 && onSegment(c, b, d)) return true;
  return false;
};

const rectIntersectsSegment = (rect: Rect, segment: { x1: number; y1: number; x2: number; y2: number }, padding = 0) => {
  const expanded = expandRect(rect, padding);
  const start = { x: segment.x1, y: segment.y1 };
  const end = { x: segment.x2, y: segment.y2 };
  if (pointInRect(start, expanded) || pointInRect(end, expanded)) return true;
  const topLeft = { x: expanded.x, y: expanded.y };
  const topRight = { x: expanded.x + expanded.width, y: expanded.y };
  const bottomRight = { x: expanded.x + expanded.width, y: expanded.y + expanded.height };
  const bottomLeft = { x: expanded.x, y: expanded.y + expanded.height };
  return (
    lineSegmentsIntersect(start, end, topLeft, topRight) ||
    lineSegmentsIntersect(start, end, topRight, bottomRight) ||
    lineSegmentsIntersect(start, end, bottomRight, bottomLeft) ||
    lineSegmentsIntersect(start, end, bottomLeft, topLeft)
  );
};

const outputRect = (output: LayoutItemOutput): Rect => ({
  x: output.cx - output.width / 2,
  y: output.cy - output.height / 2,
  width: output.width,
  height: output.height,
});

const scaleOutputBox = (output: LayoutItemOutput, factor: number): LayoutItemOutput => {
  const nextWidth = Math.max(42, output.width * factor);
  const nextHeight = Math.max(24, output.height * factor);
  return {
    ...output,
    width: nextWidth,
    height: nextHeight,
    x: output.cx - nextWidth / 2,
    y: output.cy - nextHeight / 2,
    scale: Math.max(0.52, (output.scale ?? 1) * factor),
  };
};

const MAPBOX_LAYER_TARGETS: Record<string, string[]> = {
  background: ['background'],
  land: ['land', 'landcover', 'landuse'],
  water: ['water', 'waterway', 'water-shadow'],
  landuse: ['landuse', 'landcover', 'land-structure-polygon'],
  landuse_park: ['landuse-park', 'national-park', 'park', 'landuse'],
  park: ['landuse-park', 'national-park', 'park', 'landuse'],
  building: ['building', 'building-top', 'building-outline'],
  road_primary: ['road','road-simple','road-primary', 'road-motorway-trunk', 'road-major-link','bridge-simple','tunnel-simple'],
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
  sessionId?: string | null;
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

export default function TravelMap({ geojson, styleCode, sessionId, visualStructure, showHeatmap = false, forceParams, fieldParams, draggable = false, currentDataset = 'layout', originPositions, layoutPositions, groundtruthPositions, onLayoutOutput, onGroundtruthChange, onMapInfoChange, onRouteSelect, selectedRouteId, rerunLayoutTrigger = 0, layoutAlgorithm = 'force', layoutSeed = 1 }: TravelMapProps) {
  const { activeRunId, appendAgentEvent, setSelectedAgentSelection, setManifest } = useAgentMap();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapRef>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const resizeDragRef = useRef<{
    edge: FrameResizeEdge;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const resizeMapFrameRef = useRef<number | null>(null);
  const resizeDraftRef = useRef<{ width: number; height: number } | null>(null);
  const hasCustomFrameSizeRef = useRef(false);
  const [debugCostField, setDebugCostField] = useState<CostField | null>(null);
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number } | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapTool, setMapTool] = useState<'select' | 'pan'>('select');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSizePanelOpen, setIsSizePanelOpen] = useState(false);
  const [mapFrameSize, setMapFrameSize] = useState<{ width: number; height: number }>(initialMapFrameSize);
  const [mapRevision, setMapRevision] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [mapLabelMatches, setMapLabelMatches] = useState<MapSearchResult[]>([]);
  const [placeMatches, setPlaceMatches] = useState<MapSearchResult[]>([]);
  const [isSearchingPlaces, setIsSearchingPlaces] = useState(false);
  const [isExportingPng, setIsExportingPng] = useState(false);
  const [isOptimizingLabels, setIsOptimizingLabels] = useState(false);
  const [navigationLineCache, setNavigationLineCache] = useState<Record<string, number[][]>>({});
  const [navigationRouteStatus, setNavigationRouteStatus] = useState<Record<string, NavigationRouteStatus>>({});
  const effectiveSessionId = sessionId || activeRunId;
  // Bounding rects of global items in map-container px space (set via onMeasured callback).
  const globalRectsRef = useRef<Rect[]>([]);
  // Always points to the latest recomputeLayout closure so handleGlobalMeasured can call it.
  const recomputeLayoutRef = useRef<() => void>(() => {});
  const fitMapToContentRef = useRef<(duration?: number) => void>(() => {});
  const scheduleMapResize = useCallback(() => {
    if (resizeMapFrameRef.current !== null) return;
    resizeMapFrameRef.current = window.requestAnimationFrame(() => {
      resizeMapFrameRef.current = null;
      const raw = mapRef.current as any;
      const map = raw?.getMap ? raw.getMap() : raw;
      map?.resize?.();
      if (!resizeDragRef.current) fitMapToContentRef.current(0);
      const refreshOverlays = () => {
        recomputeLayoutRef.current();
        setMapRevision((revision) => revision + 1);
      };
      window.requestAnimationFrame(refreshOverlays);
      window.setTimeout(refreshOverlays, 120);
    });
  }, []);
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

  const baseLines = transformedData.lines;
  const navigationStatusByRouteId = useMemo(() => {
    const next: Record<string, NavigationRouteStatus> = {};
    baseLines.forEach((feature: any) => {
      const visualId = feature.properties?.visual_id;
      const routeStyle = routeStyles.find((item: any) => item.visual_id === visualId);
      const coordinates = feature.geometry?.coordinates;
      if (!visualId || normalizeRouteRenderStyle(routeStyle?.style) !== 'navigation' || !Array.isArray(coordinates)) return;
      const cacheKey = `${visualId}:${routeCoordinateKey(coordinates)}`;
      next[visualId] = navigationRouteStatus[cacheKey] || { state: navigationLineCache[cacheKey] ? 'mapbox' : 'idle' };
    });
    return next;
  }, [baseLines, navigationLineCache, navigationRouteStatus, routeStyles]);

  useEffect(() => {
    setManifest((current) => {
      if (!current) return current;
      if (JSON.stringify(current._navigation_status || {}) === JSON.stringify(navigationStatusByRouteId)) return current;
      return { ...current, _navigation_status: navigationStatusByRouteId };
    });
  }, [navigationStatusByRouteId, setManifest]);

  useEffect(() => {
    let cancelled = false;
    const pending = baseLines
      .map((feature: any) => {
        const visualId = feature.properties?.visual_id;
        const routeStyle = routeStyles.find((item: any) => item.visual_id === visualId);
        const coordinates = feature.geometry?.coordinates;
        if (!visualId || normalizeRouteRenderStyle(routeStyle?.style) !== 'navigation' || !Array.isArray(coordinates) || coordinates.length < 2) {
          return null;
        }
        const cacheKey = `${visualId}:${routeCoordinateKey(coordinates)}`;
        return navigationLineCache[cacheKey] ? null : { cacheKey, coordinates };
      })
      .filter(Boolean) as { cacheKey: string; coordinates: number[][] }[];
    if (pending.length === 0) return;

    pending.forEach(async ({ cacheKey, coordinates }) => {
      setNavigationRouteStatus((status) => ({
        ...status,
        [cacheKey]: { state: 'loading' },
      }));
      try {
        const response = await fetch(`${API_BASE_URL}/api/multimodal/route/navigation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ coordinates }),
        });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.coordinates)) throw new Error(data.error || 'Navigation route failed');
        if (cancelled) return;
        if (data.source === 'mapbox') {
          setNavigationLineCache((cache) => cache[cacheKey] ? cache : { ...cache, [cacheKey]: data.coordinates });
        }
        setNavigationRouteStatus((status) => ({
          ...status,
          [cacheKey]: {
            state: data.source === 'mapbox' ? 'mapbox' : 'fallback',
            source: data.source || 'fallback',
            warning: data.warning,
          },
        }));
      } catch (error) {
        console.warn('Navigation route fallback:', error);
        if (!cancelled) {
          setNavigationRouteStatus((status) => ({
            ...status,
            [cacheKey]: {
              state: 'error',
              source: 'fallback',
              error: error instanceof Error ? error.message : 'Navigation route failed',
            },
          }));
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [baseLines, navigationLineCache, routeStyles]);

  const displayLines = useMemo(() => baseLines.map((feature: any) => {
    const visualId = feature.properties?.visual_id;
    const routeStyle = routeStyles.find((item: any) => item.visual_id === visualId);
    const coordinates = feature.geometry?.coordinates;
    if (!visualId || normalizeRouteRenderStyle(routeStyle?.style) !== 'navigation' || !Array.isArray(coordinates)) return feature;
    const cacheKey = `${visualId}:${routeCoordinateKey(coordinates)}`;
    const navigationCoordinates = navigationLineCache[cacheKey];
    if (!navigationCoordinates) return feature;
    return {
      ...feature,
      geometry: {
        ...feature.geometry,
        coordinates: navigationCoordinates,
      },
    };
  }), [baseLines, navigationLineCache, routeStyles]);
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
    if (!map) return;

    const pointCoords = transformedData.points
      .map((feature: any) => feature.geometry?.coordinates)
      .filter((coord: any): coord is [number, number] => (
        Array.isArray(coord) &&
        typeof coord[0] === 'number' &&
        typeof coord[1] === 'number'
      ));
    const fallbackLineCoords = displayLines.flatMap((feature: any) => (
      Array.isArray(feature.geometry?.coordinates) ? feature.geometry.coordinates : []
    ))
      .filter((coord: any): coord is [number, number] => (
        Array.isArray(coord) &&
        typeof coord[0] === 'number' &&
        typeof coord[1] === 'number'
      ));
    const coords = pointCoords.length > 0 ? pointCoords : fallbackLineCoords;
    if (coords.length === 0) return;

    const lons = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    let minLng = Math.min(...lons);
    let maxLng = Math.max(...lons);
    let minLat = Math.min(...lats);
    let maxLat = Math.max(...lats);
    if (Math.abs(maxLng - minLng) < 0.0008) {
      minLng -= 0.0004;
      maxLng += 0.0004;
    }
    if (Math.abs(maxLat - minLat) < 0.0008) {
      minLat -= 0.0004;
      maxLat += 0.0004;
    }
    const bounds: [[number, number], [number, number]] = [[minLng, minLat], [maxLng, maxLat]];

    const { width, height } = map.getContainer().getBoundingClientRect();
    if (!width || !height) return;

    const basePad = Math.max(16, Math.min(56, Math.round(Math.min(width, height) * 0.045)));

    map.fitBounds(bounds, {
      padding: {
        top: basePad,
        bottom: basePad,
        left: basePad,
        right: basePad,
      },
      duration,
      maxZoom: 15.8,
    });
  }, [displayLines, transformedData.points]);

  useEffect(() => {
    fitMapToContentRef.current = fitMapToContent;
  }, [fitMapToContent]);

  useEffect(() => {
    if (!isSearchOpen) return;
    searchInputRef.current?.focus();
  }, [isSearchOpen]);

  useEffect(() => {
    if (!mapLoaded) return;
    const refreshMapSize = () => {
      const raw = mapRef.current as any;
      const map = raw?.getMap ? raw.getMap() : raw;
      map?.resize?.();
      fitMapToContent(0);
      recomputeLayoutRef.current();
      setMapRevision((revision) => revision + 1);
    };
    const frame = window.requestAnimationFrame(refreshMapSize);
    const timer = window.setTimeout(refreshMapSize, 120);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [fitMapToContent, mapFrameSize, mapLoaded]);

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

    const visualScale = getViewportVisualScale(viewport);
    const pointObstacleRadius = Math.max(22, Math.round(32 * visualScale));
    const routeObstaclePadding = Math.max(10, Math.round(12 * visualScale));

    // Point/global obstacles remain rect-based; lines use exact segment distances.
    const obstacles = buildObstacleRects(
      { pointsPx, linesPx: [], polygonsPx: [] },
      { pointRadius: pointObstacleRadius, lineHalfWidth: routeObstaclePadding, polygonHalfWidth: 0, lineSampleStep: 24 }
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

    const viewportRect: Rect = { x: 0, y: 0, width: viewport.width, height: viewport.height };
    const protectedObstacles = [...allObstacles];
    const outputCollides = (output: LayoutItemOutput) => {
      const rect = outputRect(output);
      const insideViewport = (
        rect.x >= 4 &&
        rect.y >= 4 &&
        rect.x + rect.width <= viewportRect.width - 4 &&
        rect.y + rect.height <= viewportRect.height - 4
      );
      if (!insideViewport) return true;
      if (protectedObstacles.some((obstacle) => rectsOverlap(rect, obstacle, 8))) return true;
      return segments.some((segment) => rectIntersectsSegment(rect, segment, routeObstaclePadding));
    };

    const collisionSafeOutputs = outputs.flatMap((output) => {
      if (!outputCollides(output)) return [output];
      if (output.hierarchy === 'detail') return [];

      const shrinkFactor = output.hierarchy === 'core' ? 0.82 : 0.74;
      const shrunk = scaleOutputBox(output, shrinkFactor);
      if (!outputCollides(shrunk)) return [shrunk];

      const secondPass = scaleOutputBox(output, output.hierarchy === 'core' ? 0.68 : 0.6);
      return outputCollides(secondPass) ? [] : [secondPass];
    });
    const visibleOutputIds = new Set(collisionSafeOutputs.map((output) => output.id));
    const collisionSafeLeaderLines = leaderLines.filter((line) => visibleOutputIds.has(line.id));
    
    const outputsWithLngLat = collisionSafeOutputs.map(o => {
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
    setLayoutState((s) => ({ ...s, viewport, outputs: outputsWithLngLat, leaderLines: collisionSafeLeaderLines, metadata }));
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

      scheduleMapResize();
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(root);
    window.addEventListener('resize', updateSize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, [scheduleMapResize]);

  useEffect(() => {
    return () => {
      if (resizeFrameRef.current !== null) window.cancelAnimationFrame(resizeFrameRef.current);
      if (resizeMapFrameRef.current !== null) window.cancelAnimationFrame(resizeMapFrameRef.current);
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
    setMapRevision((revision) => revision + 1);
    console.log("onMoveEnd:",layoutState.inputs, layoutState.outputs);
  }, [recomputeLayout, onMapInfoChange]);

  const onMapClick = useCallback((event: any) => {
    if (mapTool === 'pan') return;
    const feature = event.features?.find((item: any) => item.geometry?.type === 'LineString');
    if (feature?.properties?.visual_id) {
      onRouteSelect?.(feature.properties.visual_id);
      const routeStyleIndex = routeStyles.findIndex((route: any) => route.visual_id === feature.properties.visual_id);
      const routeStyle = routeStyleIndex >= 0 ? routeStyles[routeStyleIndex] : undefined;
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
          routeStyleIndex,
          styleSection: 'Route',
          styleIndex: routeStyleIndex,
          geometryType: 'LineString',
        },
      });
    }
  }, [mapTool, onRouteSelect, routeStyles, setSelectedAgentSelection]);

  const selectMapFeature = useCallback((feature: any, kind: 'point' | 'label' | 'layout_label') => {
    const props = feature?.properties || {};
    const pointStyleIndex = pointStyles.findIndex((style: any) => style.visual_id === props.visual_id);
    const pointStyle = pointStyleIndex >= 0 ? pointStyles[pointStyleIndex] : undefined;
    const labelStyle = selectLabelStyleForFeature(feature, labelStyles);
    const labelStyleIndex = labelStyle ? labelStyles.indexOf(labelStyle) : -1;
    setSelectedAgentSelection({
      kind: 'map_feature',
      node_id: `map_${kind}`,
      label: props.name || props.label_title || props.visual_id || kind,
      payload: {
        feature,
        pointStyle,
        pointStyleIndex,
        labelStyle,
        labelStyleIndex,
        styleSection: kind === 'point' ? 'Point' : 'Label',
        styleIndex: kind === 'point' ? pointStyleIndex : labelStyleIndex,
        geometryType: feature?.geometry?.type,
      },
    });
  }, [labelStyles, pointStyles, setSelectedAgentSelection]);

  const selectGlobalElement = useCallback((element: any, index: number) => {
    const content = Array.isArray(transformedData.globalProps)
      ? transformedData.globalProps[index] || {}
      : transformedData.globalProps || {};
    setSelectedAgentSelection({
      kind: 'map_feature',
      node_id: 'map_global',
      label: content.title || element?.content?.title || element?.visual_id || `Global ${index + 1}`,
      payload: {
        globalStyle: element,
        globalContent: content,
        styleSection: 'Global',
        styleIndex: index,
        geometryType: 'Global',
      },
    });
  }, [setSelectedAgentSelection, transformedData.globalProps]);

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
      const raw = mapRef.current as any;
      const map = raw?.getMap ? raw.getMap() : raw;
      const mapCanvas = map?.getCanvas?.() as HTMLCanvasElement | undefined;
      if (!mapCanvas) throw new Error('Map canvas is not ready');
      const blob = await composeViewportPngBlob(root, map, mapCanvas);
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

  const optimizeLabels = useCallback(async () => {
    const root = rootRef.current;
    if (!root || isOptimizingLabels) return;
    if (!effectiveSessionId) {
      alert('Run a session before optimizing labels.');
      return;
    }
    setIsOptimizingLabels(true);
    try {
      const raw = mapRef.current as any;
      const map = raw?.getMap ? raw.getMap() : raw;
      const mapCanvas = map?.getCanvas?.() as HTMLCanvasElement | undefined;
      if (!mapCanvas) throw new Error('Map canvas is not ready');
      const blob = await composeViewportPngBlob(root, map, mapCanvas);
      const screenshot = await blobToDataUrl(blob);
      const response = await fetch(`${API_BASE_URL}/api/multimodal/session/${effectiveSessionId}/optimize-label-layout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          screenshot,
          viewport: viewportSize,
          geojson,
          style_code: styleCode,
          layout: {
            inputs: layoutState.inputs,
            outputs: layoutState.outputs,
            leaderLines: layoutState.leaderLines,
          },
          max_rounds: 3,
        }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || 'Label optimization failed');
      appendAgentEvent({
        type: 'node_completed',
        run_id: effectiveSessionId,
        session_id: effectiveSessionId,
        node_id: 'label_optimization',
        label: 'Label optimization',
        status: data.validation?.passed ? 'passed' : 'completed',
        payload: data,
        timestamp: new Date().toISOString(),
      });
      alert(data.validation?.passed ? 'Label layout validation passed.' : 'Label optimization completed with issues.');
    } catch (error: any) {
      console.error('Optimize labels failed:', error);
      alert(error?.message || 'Optimize labels failed.');
    } finally {
      setIsOptimizingLabels(false);
    }
  }, [appendAgentEvent, effectiveSessionId, geojson, isOptimizingLabels, layoutState.inputs, layoutState.leaderLines, layoutState.outputs, styleCode, viewportSize]);

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
  const projectFeatureToScreen = useCallback((feature: any) => {
    const raw = mapRef.current as any;
    const map = raw?.getMap ? raw.getMap() : raw;
    const coord = feature?.geometry?.coordinates;
    if (!map || !Array.isArray(coord)) return null;
    const point = map.project(coord);
    return { x: point.x, y: point.y };
  }, [mapRevision]);

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
  }, [layoutState.outputs, groundtruthPositions, mapRef, mapRevision]);

  const displayLeaderLines = currentDataset === 'groundtruth' && groundtruthLeaderLines.length > 0
    ? groundtruthLeaderLines
    : layoutState.leaderLines;
  const labelStyleByOutputId = useMemo(() => {
    const next = new Map<string, any>();
    transformedData.points.forEach((feature: any) => {
      const labelStyle = selectLabelStyleForFeature(feature, labelStyles);
      next.set(getFeatureLabelId(feature, labelStyle), labelStyle);
    });
    return next;
  }, [labelStyles, transformedData.points]);

  const selectLeaderLine = useCallback((leader: LeaderLine) => {
    if (mapTool === 'pan') return;
    const labelStyle = labelStyleByOutputId.get(leader.id);
    const labelStyleIndex = labelStyle ? labelStyles.indexOf(labelStyle) : -1;
    const output = layoutState.outputs.find((item) => item.id === leader.id);
    setSelectedAgentSelection({
      kind: 'map_feature',
      node_id: 'map_leader_line',
      label: output?.id || 'Leader line',
      payload: {
        leaderLine: leader,
        labelStyle,
        styleSection: 'Label',
        styleIndex: labelStyleIndex,
        geometryType: 'LeaderLine',
      },
    });
  }, [labelStyleByOutputId, labelStyles, layoutState.outputs, mapTool, setSelectedAgentSelection]);

  const fallbackOverlayCount = transformedData.points.length;
  const fallbackLabelScale = getResponsiveOverlayScale('secondary', viewportSize, fallbackOverlayCount);
  const hideDetailLabels = shouldHideOverlay('detail', viewportSize, fallbackOverlayCount);
  const viewportVisualScale = getViewportVisualScale(viewportSize);
  const mapOverlayReady = mapLoaded && Boolean((mapRef.current as any)?.getMap ? (mapRef.current as any).getMap() : mapRef.current);
  const frameBounds = useCallback(() => {
    const parent = rootRef.current?.parentElement?.getBoundingClientRect();
    return {
      maxWidth: Math.max(MIN_FRAME_WIDTH, Math.floor(parent?.width || window.innerWidth)),
      maxHeight: Math.max(MIN_FRAME_HEIGHT, Math.floor(parent?.height || window.innerHeight)),
    };
  }, []);

  const updateMapFrameSize = useCallback((updates: Partial<{ width: number; height: number }>) => {
    const { maxWidth, maxHeight } = frameBounds();
    setMapFrameSize((prev) => ({
      width: Math.max(MIN_FRAME_WIDTH, Math.min(maxWidth, Math.round(updates.width ?? prev.width))),
      height: Math.max(MIN_FRAME_HEIGHT, Math.min(maxHeight, Math.round(updates.height ?? prev.height))),
    }));
  }, [frameBounds]);

  const setMapFrameRatio = useCallback((widthRatio: number, heightRatio: number) => {
    hasCustomFrameSizeRef.current = true;
    const { maxWidth, maxHeight } = frameBounds();
    const scale = Math.min(maxWidth / widthRatio, maxHeight / heightRatio);
    updateMapFrameSize({
      width: widthRatio * scale,
      height: heightRatio * scale,
    });
  }, [frameBounds, updateMapFrameSize]);

  useEffect(() => {
    const parent = rootRef.current?.parentElement;
    if (!parent) return;

    const fillAvailableSpace = () => {
      if (hasCustomFrameSizeRef.current) return;
      const { maxWidth, maxHeight } = frameBounds();
      updateMapFrameSize({ width: maxWidth, height: maxHeight });
    };

    fillAvailableSpace();
    const observer = new ResizeObserver(fillAvailableSpace);
    observer.observe(parent);
    window.addEventListener('resize', fillAvailableSpace);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fillAvailableSpace);
    };
  }, [frameBounds, updateMapFrameSize]);

  const startFrameResize = useCallback((edge: FrameResizeEdge, event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    hasCustomFrameSizeRef.current = true;
    resizeDragRef.current = {
      edge,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: mapFrameSize.width,
      startHeight: mapFrameSize.height,
    };
    resizeDraftRef.current = mapFrameSize;
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic pointer events in tests may not have an active pointer.
    }
  }, [mapFrameSize]);

  const updateFrameResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = resizeDragRef.current;
    if (!drag) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (drag.edge === 'left' || drag.edge === 'right') {
      const direction = drag.edge === 'right' ? 1 : -1;
      resizeDraftRef.current = { width: drag.startWidth + deltaX * direction * 2, height: drag.startHeight };
    } else {
      const direction = drag.edge === 'bottom' ? 1 : -1;
      resizeDraftRef.current = { width: drag.startWidth, height: drag.startHeight + deltaY * direction * 2 };
    }
    if (resizeFrameRef.current !== null) return;
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      const draft = resizeDraftRef.current;
      const frame = rootRef.current;
      if (!draft || !frame) return;
      const { maxWidth, maxHeight } = frameBounds();
      const width = Math.max(MIN_FRAME_WIDTH, Math.min(maxWidth, Math.round(draft.width)));
      const height = Math.max(MIN_FRAME_HEIGHT, Math.min(maxHeight, Math.round(draft.height)));
      resizeDraftRef.current = { width, height };
      frame.style.width = `${width}px`;
      frame.style.height = `${height}px`;
      scheduleMapResize();
    });
  }, [frameBounds, scheduleMapResize]);

  const stopFrameResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const draft = resizeDraftRef.current;
    resizeDragRef.current = null;
    resizeDraftRef.current = null;
    if (draft) {
      updateMapFrameSize(draft);
      scheduleMapResize();
    }
    try {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }
    } catch {
      // Keep resize cleanup best-effort for synthetic pointer events.
    }
  }, [scheduleMapResize, updateMapFrameSize]);

  const resizeHandleClass = "absolute z-30 bg-transparent transition-colors hover:bg-black/10";
  const mapToolbar = (
    <div data-export-ignore="true" className="absolute right-3 top-3 z-40 flex w-[260px] flex-col gap-2">
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
        <button
          type="button"
          title="Optimize label layout"
          onClick={optimizeLabels}
          disabled={isOptimizingLabels || !effectiveSessionId}
          className="agent-theme-map-tool-idle grid h-8 w-8 place-items-center rounded disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SparklesIcon className={`h-4 w-4 ${isOptimizingLabels ? 'animate-pulse' : ''}`} />
        </button>
        <div className="mx-1 h-5 w-px bg-gray-200" />
        <button
          type="button"
          title="Resize map frame"
          onClick={() => setIsSizePanelOpen((open) => !open)}
          className={`grid h-8 w-8 place-items-center rounded ${isSizePanelOpen ? 'agent-theme-map-tool-active' : 'agent-theme-map-tool-idle'}`}
        >
          <Maximize2Icon className="h-4 w-4" />
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

      {isSizePanelOpen && (
        <div className="agent-theme-map-toolbar rounded-md border p-2 text-[11px] shadow-sm backdrop-blur">
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-gray-600">
              W
              <input
                type="number"
                min={360}
                max={2400}
                step={20}
                value={mapFrameSize.width}
                onChange={(event) => {
                  hasCustomFrameSizeRef.current = true;
                  updateMapFrameSize({ width: Number(event.target.value) });
                }}
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
                onChange={(event) => {
                  hasCustomFrameSizeRef.current = true;
                  updateMapFrameSize({ height: Number(event.target.value) });
                }}
                className="h-7 w-16 rounded border border-gray-200 px-1.5 text-gray-800 outline-none"
              />
            </label>
          </div>
          <div className="mt-2 flex gap-1">
            <button type="button" className="flex-1 rounded border border-gray-200 px-2 py-1 text-gray-700 hover:bg-gray-50" onClick={() => setMapFrameRatio(16, 10)}>16:10</button>
            <button type="button" className="flex-1 rounded border border-gray-200 px-2 py-1 text-gray-700 hover:bg-gray-50" onClick={() => setMapFrameRatio(1, 1)}>1:1</button>
            <button type="button" className="flex-1 rounded border border-gray-200 px-2 py-1 text-gray-700 hover:bg-gray-50" onClick={() => setMapFrameRatio(9, 14)}>9:14</button>
          </div>
        </div>
      )}

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
  );

  return (
    <div className="relative h-full w-full overflow-auto bg-gray-100">
      <div className="flex h-full min-h-full w-full items-center justify-center">
      <div
        ref={rootRef}
        data-agent-map-frame="true"
        className="relative overflow-hidden bg-white shadow-sm"
        style={{ width: mapFrameSize.width, height: mapFrameSize.height }}
      >
        <div
          data-agent-resize-edge="left"
          className={`${resizeHandleClass} left-0 top-0 h-full w-2 cursor-ew-resize`}
          onPointerDown={(event) => startFrameResize('left', event)}
          onPointerMove={updateFrameResize}
          onPointerUp={stopFrameResize}
          onPointerCancel={stopFrameResize}
        />
        <div
          data-agent-resize-edge="right"
          className={`${resizeHandleClass} right-0 top-0 h-full w-2 cursor-ew-resize`}
          onPointerDown={(event) => startFrameResize('right', event)}
          onPointerMove={updateFrameResize}
          onPointerUp={stopFrameResize}
          onPointerCancel={stopFrameResize}
        />
        <div
          data-agent-resize-edge="top"
          className={`${resizeHandleClass} left-0 top-0 h-2 w-full cursor-ns-resize`}
          onPointerDown={(event) => startFrameResize('top', event)}
          onPointerMove={updateFrameResize}
          onPointerUp={stopFrameResize}
          onPointerCancel={stopFrameResize}
        />
        <div
          data-agent-resize-edge="bottom"
          className={`${resizeHandleClass} bottom-0 left-0 h-2 w-full cursor-ns-resize`}
          onPointerDown={(event) => startFrameResize('bottom', event)}
          onPointerMove={updateFrameResize}
          onPointerUp={stopFrameResize}
          onPointerCancel={stopFrameResize}
        />
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
          <RouteRenderer
            routeStyles={routeStyles}
            transformedLayers={transformedLayers}
            selectedRouteId={selectedRouteId}
            visualScale={viewportVisualScale}
          />
          {mapOverlayReady && (
            <PointRenderer
              points={transformedData.points}
              pointStyles={pointStyles}
              globalProps={transformedData.globalProps}
              visualScale={viewportVisualScale}
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
            <defs>
              {displayLeaderLines.map((l, index) => {
                const leaderStyle = resolveLeaderLineStyle(labelStyleByOutputId.get(l.id));
                if (!leaderStyle.arrow) return null;
                const markerId = `leader-arrow-${index}`;
                return (
                  <marker
                    key={`leader-arrow-${l.id}`}
                    id={markerId}
                    markerWidth="8"
                    markerHeight="8"
                    refX="7"
                    refY="4"
                    orient="auto"
                    markerUnits="strokeWidth"
                  >
                    <path d="M0,0 L8,4 L0,8 Z" fill={leaderStyle.color} opacity={leaderStyle.opacity} />
                  </marker>
                );
              })}
            </defs>
            {displayLeaderLines.map((l, index) => {
              const leaderStyle = resolveLeaderLineStyle(labelStyleByOutputId.get(l.id));
              const markerId = `leader-arrow-${index}`;
              const output = layoutState.outputs.find((item) => item.id === l.id);
              const end = output
                ? lineRectEdgePoint(
                    { x: l.x1, y: l.y1 },
                    {
                      x: l.x2 - output.width / 2,
                      y: l.y2 - output.height / 2,
                      width: output.width,
                      height: output.height,
                    },
                  )
                : { x: l.x2, y: l.y2 };
              return (
                <React.Fragment key={`leader-${l.id}`}>
                  <line
                    x1={l.x1}
                    y1={l.y1}
                    x2={end.x}
                    y2={end.y}
                    stroke="transparent"
                    strokeWidth={Math.max(10, leaderStyle.width + 8)}
                    style={{
                      cursor: mapTool === 'select' ? 'pointer' : 'default',
                      pointerEvents: mapTool === 'select' ? 'stroke' : 'none',
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectLeaderLine(l);
                    }}
                  />
                  <line
                    x1={l.x1}
                    y1={l.y1}
                    x2={end.x}
                    y2={end.y}
                    stroke={leaderStyle.color}
                    strokeWidth={leaderStyle.width}
                    strokeOpacity={leaderStyle.opacity}
                    strokeDasharray={leaderStyle.dashArray.join(' ') || undefined}
                    markerEnd={leaderStyle.arrow ? `url(#${markerId})` : undefined}
                    style={{
                      cursor: mapTool === 'select' ? 'pointer' : 'default',
                      pointerEvents: mapTool === 'select' ? 'stroke' : 'none',
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectLeaderLine(l);
                    }}
                  />
                </React.Fragment>
              );
            })}
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
          selectable={mapTool === 'select'}
          onGlobalSelect={selectGlobalElement}
        />
      )}
      </div>
    </div>
    {mapToolbar}
    </div>
  );
}
