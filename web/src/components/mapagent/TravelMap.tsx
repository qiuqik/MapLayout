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

import type { LayoutItemInput, LayoutItemOutput, LayoutItemPosition, LeaderLine } from '@/app/agent/layout/types';
import { buildObstacleRects, buildObstacleSegments } from '@/app/agent/layout/obstacles';
import { buildCostFieldFromRects, type CostField } from '@/app/agent/layout/costField';
import { runForceLayout, type LayoutParams } from '@/app/agent/layout/forceLayout';
import DebugOverlay from './DebugOverlay';
import type { ForceParamsOverride, FieldParamsOverride } from './ForceParamsPanel';

const DEFAULT_FORCE: LayoutParams = {
  linkStrength: 0.16,
  lift: 22,
  collideStrength: 3.5,
  fieldStrength: 1.8,
  boundsPadding: 12,
  alpha: 1,
  alphaDecay: 0.045,
  alphaMin: 0.001,
  iterations: 360,
  leaderThreshold: 28,
};

const DEFAULT_FIELD: FieldParamsOverride = {
  sigma: 28,
  strength: 1400,
  obstaclePadding: 6,
  cellSize: 24,
};

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
  onLayoutOutput?: (outputs: LayoutItemOutput[], inputs: LayoutItemInput[]) => void;
  onGroundtruthChange?: (positions: Record<string, { lng: number; lat: number }>) => void;
  onMapInfoChange?: (mapInfo: { center: { lng: number; lat: number }; bounds: { north: number; south: number; east: number; west: number } }) => void;
  rerunLayoutTrigger?: number;
}

export default function TravelMap({ geojson, styleCode, showHeatmap = false, forceParams, fieldParams, draggable = false, currentDataset = 'layout', originPositions, layoutPositions, groundtruthPositions, onLayoutOutput, onGroundtruthChange, onMapInfoChange, rerunLayoutTrigger = 0 }: TravelMapProps) {
  const mapRef = useRef<MapRef>(null);
  const [debugCostField, setDebugCostField] = useState<CostField | null>(null);
  const [layoutState, setLayoutState] = useState<{
    inputs: LayoutItemInput[];
    outputs: LayoutItemOutput[];
    leaderLines: LeaderLine[];
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

  const processLayoutInput = (id: string, feature: any, globalProps: any, cardVisualId: string, styles: any[]) => {
    var positions = originPositions;
    if(currentDataset === 'layout'){
      positions = layoutPositions;
    }else if(currentDataset === 'groundtruth'){
      positions = groundtruthPositions;
      if(!positions) positions = layoutPositions;
    }
    var input = [];
    for(let i = 0; i < positions.length; i++){
      const position = positions[i];
      if(position.id !== id) continue;
      const style = styles.find((l: any) => l.visual_id === cardVisualId);
      if(style) {
        const html = populateTemplate(style.template, feature.properties, globalProps);
        input.push({
          ...position,
          html,
          width: 0,
          height: 0,
          padding: 14,
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

    for (let i = 0; i < allTransformedFeatures.length; i++) {
      const feature: any = allTransformedFeatures[i];
      const name = feature.properties?.name;
      const type = feature.geometry.type;
      if(feature.properties?.card_coord){
        const cardVisualId = feature.properties?.card_visual_id;
        const id = `card-${type}-${name}-${cardVisualId}`;
        // console.log("card id:", id);
        const input = processLayoutInput(id, feature, globalProps, cardVisualId, cardStyles);
        if(input) inputs.push(...input);
      }
      if(feature.properties?.label_coord){
        const labelVisualId = feature.properties?.label_visual_id;
        const id = `label-${type}-${name}-${labelVisualId}`;
        // console.log("label id:", id);
        const input = processLayoutInput(id, feature, globalProps, labelVisualId, labelStyles);
        if(input) inputs.push(...input);
      }
    }
    console.log("inputs:", inputs);
    return inputs;
  }, [transformedData.points, transformedData.polygons, transformedData.globalProps, labelStyles, cardStyles]);

  useEffect(() => {
    // built layout inputs
    const next = buildLayoutInputs();
    setLayoutState((s) => {
      if (s.inputs.length !== next.length) {
        return { ...s, inputs: next, outputs: [], leaderLines: [] };
      }
      const same = s.inputs.every((it, i) => it.id === next[i].id);
      if (same) {
        return s;
      }
      // Preserve already-measured width/height values when IDs change
      const merged = next.map(newItem => {
        const oldItem = s.inputs.find(it => it.id === newItem.id);
        if (oldItem && oldItem.width > 0 && oldItem.height > 0) {
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

    const mergedField = { ...DEFAULT_FIELD, ...fieldParams };
    const field = buildCostFieldFromRects(obstacles, {
      width: viewport.width,
      height: viewport.height,
      ...mergedField,
    }, segments);

    setDebugCostField(field);
    const prevById = new Map(layoutState.outputs.map((o) => [o.id, { x: o.cx, y: o.cy }]));
    const ready = layoutState.inputs.map((it) => {
      // Use measured dimensions, fallback to conservative defaults if not yet measured
      const width = it.width > 0 ? it.width : 80;
      const height = it.height > 0 ? it.height : 32;
      const p = project(it.anchorLngLat.lng, it.anchorLngLat.lat);
      return {
        ...it,
        width,
        height,
        anchorPx: { x: p.x, y: p.y },
        prevCenter: prevById.get(it.id),
      };
    });

    const { outputs, leaderLines } = runForceLayout(
      ready,
      { viewport, costField: field, segments },
      { ...DEFAULT_FORCE, ...forceParams }
    );
    
    const outputsWithLngLat = outputs.map(o => {
      const lngLat = map.unproject([o.cx, o.cy]);
      return {
        ...o,
        centerLngLat: { lng: lngLat.lng, lat: lngLat.lat },
      };
    });
    
    console.log("after layout outputs:", outputsWithLngLat);
    setLayoutState((s) => ({ ...s, viewport, outputs: outputsWithLngLat, leaderLines }));
  }, [displayLines, transformedData.points, transformedData.polygons, forceParams, fieldParams, layoutState.inputs, rerunLayoutTrigger]);

  // useEffect(() => {
  //   if (layoutState.inputs.length === 0) return;
  //   recomputeLayout();
  // }, [layoutState.inputs, recomputeLayout]);



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
  }, [forceParams, fieldParams, rerunLayoutTrigger]);

  useEffect(() => {
    if (layoutState.outputs.length > 0 && onLayoutOutput) {
      onLayoutOutput(layoutState.outputs, layoutState.inputs);
    }
  }, [layoutState.outputs, layoutState.inputs, onLayoutOutput]);

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

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
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
            />
            <LabelRenderer
              points={transformedData.points}
              labelStyles={labelStyles}
              globalProps={transformedData.globalProps}
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
            }}
            dangerouslySetInnerHTML={{ __html: it.html }}
          />
        ))}
      </div>

      {!hideOverlays && <GlobalRenderer globalElements={globalElements} globalProps={transformedData.globalProps} />}
    </div>
  );
}
