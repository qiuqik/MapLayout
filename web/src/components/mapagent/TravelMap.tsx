'use client';

import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import MapGL, { MapRef } from 'react-map-gl/mapbox';
import { StyleSpecification } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { 
  transformAllCoordinates, 
  fetchWalkingRoute, 
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

import type { LayoutItemInput, LayoutItemOutput, LeaderLine } from '@/app/agent/layout/types';
import { buildObstacleRects, buildObstacleSegments } from '@/app/agent/layout/obstacles';
import { buildCostFieldFromRects } from '@/app/agent/layout/costField';
import { runForceLayout } from '@/app/agent/layout/forceLayout';

interface TravelMapProps {
  geojson: any;
  styleCode: any;
}

export default function TravelMap({ geojson, styleCode }: TravelMapProps) {
  const mapRef = useRef<MapRef>(null);
  const [processedLines, setProcessedLines] = useState<any[]>([]);
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

  const hasNavigationCurve = routeStyles.some((rs: any) => rs.style === 'navigationCurve');

  useEffect(() => {
    const processRoutes = async () => {
      if (hasNavigationCurve && process.env.NEXT_PUBLIC_MAPBOX_TOKEN) {
        try {
          const processed: any[] = [];
          
          for (const feature of transformedData.lines) {
            const routeStyle = routeStyles.find((rs: any) => rs.visual_id === feature.properties?.visual_id);
            
            if (routeStyle?.style === 'navigationCurve') {
              const coords = feature.geometry.coordinates;
              const pathCoords = await fetchWalkingRoute(coords, process.env.NEXT_PUBLIC_MAPBOX_TOKEN!);
              
              processed.push({
                ...feature,
                geometry: {
                  type: 'LineString',
                  coordinates: pathCoords
                }
              });
            } else {
              processed.push(feature);
            }
          }
          
          // setProcessedLines(processed);
          setProcessedLines(prev => {
            if(
              prev.length === processed.length &&
              prev.every((p, index) => p.properties.visual_id === processed[index].properties.visual_id)
            ) {
              return prev;
            }
            return processed;
          })
        } catch (error) {
          console.warn('Failed to process navigation routes, using straight lines:', error);
          setProcessedLines(prev => (prev === transformedData.lines ? prev : transformedData.lines));
        }
      } else {
        setProcessedLines(prev => (prev === transformedData.lines ? prev : transformedData.lines));
      }
    };
    
    processRoutes();
  }, [transformedData.lines,routeStyles, hasNavigationCurve]);

  const displayLines = hasNavigationCurve && process.env.NEXT_PUBLIC_MAPBOX_TOKEN && processedLines.length > 0 
    ? processedLines 
    : transformedData.lines;

  const getMapViewState = useMemo(() => {
    const dataForCalc: TransformedMapData = {
      ...transformedData,
      lines: displayLines
    };
    return calculateMapViewState(dataForCalc);
  }, [transformedData, displayLines]);

  useEffect(() => {
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
          [Math.min(...lons) - 0.01, Math.min(...lats) - 0.01],
          [Math.max(...lons) + 0.01, Math.max(...lats) + 0.01],
        ];
        mapRef.current.fitBounds(bounds, { padding: 40, duration: 1500 });
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

  const mapStyle = baseMapStyle?.type === 'blank' 
    ? blankMapStyle
    : baseMapStyle?.type === 'satellite'
      ? 'mapbox://styles/mapbox/satellite-v9'
      : 'mapbox://styles/mapbox/streets-v12';

  const buildLayoutInputs = useCallback((): LayoutItemInput[] => {
    const inputs: LayoutItemInput[] = [];
    const globalProps = transformedData.globalProps;

    for (let i = 0; i < transformedData.points.length; i++) {
      const feature: any = transformedData.points[i];
      const name = feature.properties?.name ?? `p${i}`;

      const labelStyle = labelStyles.find((l: any) => l.visual_id === feature.properties?.label_visual_id);
      if (labelStyle) {
        const coord = feature.properties?.label_coord || feature.geometry.coordinates;
        const [lng, lat] = coord;
        const html = populateTemplate(labelStyle.template, feature.properties, globalProps);
        inputs.push({
          id: `label-point-${name}-${labelStyle.visual_id ?? i}`,
          kind: 'label',
          anchorLngLat: { lng, lat },
          html,
          width: 0,
          height: 0,
          padding: 14,
        });
      }

      const cardStyle = cardStyles.find((c: any) => c.visual_id === feature.properties?.card_visual_id);
      if (cardStyle) {
        const coord = feature.properties?.card_coord || feature.geometry.coordinates;
        const [lng, lat] = coord;
        const html = populateTemplate(cardStyle.template, feature.properties, globalProps);
        inputs.push({
          id: `card-point-${name}-${cardStyle.visual_id ?? i}`,
          kind: 'card',
          anchorLngLat: { lng, lat },
          html,
          width: 0,
          height: 0,
          padding: 28,
        });
      }
    }

    for (let i = 0; i < transformedData.polygons.length; i++) {
      const feature: any = transformedData.polygons[i];
      const name = feature.properties?.name ?? `poly${i}`;
      const cardStyle = cardStyles.find((c: any) => c.visual_id === feature.properties?.card_visual_id);
      if (!cardStyle) continue;
      const coord = feature.properties?.card_coord || feature.geometry.coordinates?.[0]?.[0];
      if (!coord) continue;
      const [lng, lat] = coord;
      const html = populateTemplate(cardStyle.template, feature.properties, transformedData.globalProps);
      inputs.push({
        id: `card-polygon-${name}-${cardStyle.visual_id ?? i}`,
        kind: 'card',
        anchorLngLat: { lng, lat },
        html,
        width: 0,
        height: 0,
        padding: 28,
      });
    }

    return inputs;
  }, [transformedData.points, transformedData.polygons, transformedData.globalProps, labelStyles, cardStyles]);

  useEffect(() => {
    const next = buildLayoutInputs();
    setLayoutState((s) => {
      if (s.inputs.length !== next.length) {
        return { ...s, inputs: next, outputs: [], leaderLines: [] };
      }
      const same = s.inputs.every((it, i) => it.id === next[i].id);
      if (same) {
        return s;
      }
      return { ...s, inputs: next, outputs: [], leaderLines: [] };
    });
  }, [buildLayoutInputs]);

  useEffect(() => {
    const root = measureRootRef.current;
    if (!root) return;
    if (layoutState.inputs.length === 0) return;

    let changed = false;
    const measured = layoutState.inputs.map((it) => {
      // 只测量还没有尺寸的元素，避免无限 setState 循环
      if (it.width > 0 && it.height > 0) {
        return it;
      }
      const el = root.querySelector(
        `[data-layout-id="${CSS.escape(it.id)}"]`
      ) as HTMLElement | null;
      const rect = el?.getBoundingClientRect();
      const width = rect?.width ?? 0;
      const height = rect?.height ?? 0;
      if (width > 0 && height > 0) {
        changed = true;
        return { ...it, width, height };
      }
      return it;
    });

    if (!changed) return;
    setLayoutState((s) => ({ ...s, inputs: measured }));
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

    const field = buildCostFieldFromRects(obstacles, {
      width: viewport.width,
      height: viewport.height,
      cellSize: 24,
      sigma: 28,
      strength: 1400,
      obstaclePadding: 6,
    }, segments);

    const prevById = new Map(layoutState.outputs.map((o) => [o.id, { x: o.cx, y: o.cy }]));
    const ready = layoutState.inputs.map((it) => {
      // 宽高测不到时给一个保守的默认值，保证布局可用
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
      { viewport, costField: field },
      {
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
      }
    );

    setLayoutState((s) => ({ ...s, viewport, outputs, leaderLines }));
  }, [displayLines, transformedData.points, transformedData.polygons]);

  useEffect(() => {
    if (layoutState.inputs.length === 0) return;
    recomputeLayout();
  }, [layoutState.inputs, recomputeLayout]);

  const onMapLoad = useCallback(() => {
    recomputeLayout();
  }, [recomputeLayout]);

  const onMoveEnd = useCallback(() => {
    recomputeLayout();
  }, [recomputeLayout]);

      
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <BaseMapRenderer baseMapStyle={baseMapStyle} />
      
      <MapGL
        ref={mapRef}
        initialViewState={getMapViewState}
        mapStyle={mapStyle}
        mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
        style={{ width: '100%', height: '100%', zIndex: 1 }}
        onLoad={onMapLoad}
        onMoveEnd={onMoveEnd}
      >
        <AreaRenderer areaStyles={areaStyles} transformedLayers={transformedLayers} />
        <RouteRenderer routeStyles={routeStyles} transformedLayers={transformedLayers} />
        <PointRenderer points={transformedData.points} pointStyles={pointStyles} />
        {layoutState.outputs.length === 0 && (
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
          {layoutState.leaderLines.map((l) => (
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

        {layoutState.outputs.map((o) => (
          <div
            key={o.id}
            style={{
              position: 'absolute',
              left: `${o.x}px`,
              top: `${o.y}px`,
              pointerEvents: 'auto',
            }}
            dangerouslySetInnerHTML={{ __html: o.html }}
          />
        ))}
      </div>

      <div
        ref={measureRootRef}
        style={{
          position: 'absolute',
          left: -100000,
          top: -100000,
          width: 0,
          height: 0,
          overflow: 'hidden',
          visibility: 'hidden',
        }}
      >
        {layoutState.inputs.map((it) => (
          <div key={`measure-${it.id}`} data-layout-id={it.id} dangerouslySetInnerHTML={{ __html: it.html }} />
        ))}
      </div>

      <GlobalRenderer globalElements={globalElements} globalProps={transformedData.globalProps} />
    </div>
  );
}
