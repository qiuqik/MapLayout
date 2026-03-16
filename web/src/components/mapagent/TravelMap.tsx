'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import Map, { MapRef } from 'react-map-gl/mapbox';
import { StyleSpecification } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { 
  transformAllCoordinates, 
  fetchWalkingRoute, 
  calculateMapViewState,
  TransformedMapData 
} from './utils/mapUtils';
import BaseMapRenderer from './renderers/BaseMapRenderer';
import GlobalRenderer from './renderers/GlobalRenderer';
import AreaRenderer from './renderers/AreaRenderer';
import RouteRenderer from './renderers/RouteRenderer';
import PointRenderer from './renderers/PointRenderer';
import CardRenderer from './renderers/CardRenderer';
import LabelRenderer from './renderers/LabelRenderer';

interface TravelMapProps {
  geojson: any;
  styleCode: any;
}

export default function TravelMap({ geojson, styleCode }: TravelMapProps) {
  const mapRef = useRef<MapRef>(null);
  const [processedLines, setProcessedLines] = useState<any[]>([]);
  
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
          const processed = [];
          
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
          
          setProcessedLines(processed);
        } catch (error) {
          console.warn('Failed to process navigation routes, using straight lines:', error);
          setProcessedLines(transformedData.lines);
        }
      } else {
        setProcessedLines(transformedData.lines);
      }
    };
    
    processRoutes();
  }, [transformedData.lines, routeStyles, hasNavigationCurve]);

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

      
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <BaseMapRenderer baseMapStyle={baseMapStyle} />
      
      <Map
        ref={mapRef}
        initialViewState={getMapViewState}
        mapStyle={mapStyle}
        mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
        style={{ width: '100%', height: '100%', zIndex: 1 }}
      >
        <AreaRenderer areaStyles={areaStyles} transformedLayers={transformedLayers} />
        <RouteRenderer routeStyles={routeStyles} transformedLayers={transformedLayers} />
        <PointRenderer points={transformedData.points} pointStyles={pointStyles} />
        <CardRenderer points={transformedData.points} polygons={transformedData.polygons} cardStyles={cardStyles} globalProps={transformedData.globalProps} />
        <LabelRenderer points={transformedData.points} labelStyles={labelStyles} globalProps={transformedData.globalProps} />
      </Map>
      
      <GlobalRenderer globalElements={globalElements} globalProps={transformedData.globalProps} />
    </div>
  );
}
