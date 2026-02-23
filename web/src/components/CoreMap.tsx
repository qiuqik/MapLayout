'use client';

import React, { useState, useEffect, useRef, useContext, useMemo } from 'react';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { StyleSpecification } from 'mapbox-gl';
import Map, { NavigationControl, MapRef, Marker } from 'react-map-gl/mapbox';
import { MapDataContext } from '@/lib/mapContext';
import { gcj02ToWgs84, wgs84ToGcj02 } from '@/lib/gcl2wgs';
import dynamic from 'next/dynamic';

import MainLine from './map/MainLine';
import MainPoint from './map/MainPoint';
import ConnectLine from './map/ConnectLine';

const InfoCard = dynamic(() => import('./map/InfoCard'), {
  ssr: false,
});

export interface MapStyleConfig {
  mapConfig?: {
    baseMap?: 'blank' | 'standard' | 'satellite';
    backgroundColor?: string;
  };
  route?: {
    color?: string;
    width?: number;
    style?: 'straightLine' | 'navigationCurve';
  };
  point?: {
    type?: 'default' | 'svg';
    color?: string;
    iconSvg?: string;
  };
  connectLine?: {
    color?: string;
    type?: 'straight' | 'curve';
    arrowDirection?: 'none' | 'point-to-card' | 'card-to-point';
  };
  card?: {
    containerStyle?: React.CSSProperties;
    elements?: {
      title?: { show?: boolean; style?: React.CSSProperties };
      desc?: { show?: boolean; style?: React.CSSProperties };
      tags?: { show?: boolean; containerStyle?: React.CSSProperties; itemStyle?: React.CSSProperties };
      category?: { show?: boolean; style?: React.CSSProperties };
      rating?: { show?: boolean; style?: React.CSSProperties };
      address?: { show?: boolean; style?: React.CSSProperties };
      openTime?: { show?: boolean; style?: React.CSSProperties };
      ticketPrice?: { show?: boolean; style?: React.CSSProperties };
      chart?: { show?: boolean; style?: React.CSSProperties };
    };
  };
}

const CARD_OFFSET = 0.01;

const CoreMap: React.FC = () => {
  const { geofilename, stylename } = useContext(MapDataContext);
  const mapRef = useRef<MapRef>(null);

  const [geojson, setGeojson] = useState<any>(null);
  const rawGeojsonRef = useRef<any>(null);
  const [mapStyle, setMapStyle] = useState<MapStyleConfig | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [viewState, setViewState] = useState({
    longitude: 116.4074,
    latitude: 39.9042,
    zoom: 12,
  });

  const mapStyleUrl = useMemo(() => {
    const base = mapStyle?.mapConfig?.baseMap ?? 'standard';
    if (base === 'blank') return null;
    if (base === 'satellite') return 'mapbox://styles/mapbox/satellite-streets-v12';
    return 'mapbox://styles/mapbox/streets-v12';
  }, [mapStyle?.mapConfig?.baseMap]);

  const blankMapStyle = useMemo(() => {
    if (mapStyle?.mapConfig?.baseMap !== 'blank') return undefined;
    const bg = mapStyle?.mapConfig?.backgroundColor ?? '#f8fafc';
    return {
      version: 8 as const,
      sources: {} as Record<string, never>,
      layers: [
        {
          id: 'background',
          type: 'background' as const,
          paint: { 'background-color': bg },
        },
      ],
    } as StyleSpecification;
  }, [mapStyle?.mapConfig?.baseMap, mapStyle?.mapConfig?.backgroundColor]);

  const resolvedMapStyle: string | StyleSpecification | undefined =
    mapStyle?.mapConfig?.baseMap === 'blank' ? blankMapStyle : mapStyleUrl ?? undefined;

  useEffect(() => {
    const fetchMapStyle = async () => {
      if (!stylename) return;
      try {
        const res = await fetch(`http://localhost:8000/files/${encodeURIComponent(stylename)}`);
        const data = await res.json();
        console.log("加载到的 MapStyle:", data);
        setMapStyle(data);
      } catch (error) {
        console.error('加载本地样式失败，使用默认样式:', error);
      }
    };
    fetchMapStyle();
  }, [stylename]);

  const coordinateTrans = (geodata: any): any => {
    if (!geodata?.features) return geodata;
    const newGeodata = JSON.parse(JSON.stringify(geodata));
    for (let i = 0; i < geodata.features.length; i++) {
      if (geodata.features[i].geometry.type === 'LineString') {
        const coords = geodata.features[i].geometry.coordinates;
        for (let j = 0; j < coords.length; j++) {
          newGeodata.features[i].geometry.coordinates[j] = gcj02ToWgs84(coords[j]);
        }
      } else if (geodata.features[i].geometry.type === 'Point') {
        const coord = gcj02ToWgs84(geodata.features[i].geometry.coordinates);
        newGeodata.features[i].properties.coordinates = coord;
        newGeodata.features[i].geometry.coordinates = coord;
      }
    }
    return newGeodata;
  };

  useEffect(() => {
    if (!geofilename) return;
    const fetchGeoJson = async () => {
      try {
        const res = await fetch(`http://localhost:8000/files/${encodeURIComponent(geofilename)}`);
        const data = await res.json();
        rawGeojsonRef.current = JSON.parse(JSON.stringify(data));
        const transformedData = coordinateTrans(data);
        setGeojson(transformedData);
      } catch (e) {
        console.error('Fetch GeoJSON Error:', e);
      }
    };
    fetchGeoJson();
  }, [geofilename]);

  const saveGeojson = async (content: any) => {
    if (!geofilename) return;
    try {
      const res = await fetch(`http://localhost:8000/files/${encodeURIComponent(geofilename)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(content),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || '保存失败');
    } catch (e) {
      console.error('Save GeoJSON Error:', e);
    }
  };

  const handleCardDragEnd = (featureIdx: number, lngLat: { lng: number; lat: number }) => {
    const newCoord: [number, number] = [lngLat.lng, lngLat.lat];
    setGeojson((prev: any) => {
      if (!prev?.features) return prev;
      const next = JSON.parse(JSON.stringify(prev));
      if (next.features[featureIdx]?.geometry?.type === 'Point') {
        next.features[featureIdx].properties = next.features[featureIdx].properties || {};
        next.features[featureIdx].properties.cardcoord = newCoord;
      }
      return next;
    });
    if (rawGeojsonRef.current?.features?.[featureIdx]?.geometry?.type === 'Point') {
      rawGeojsonRef.current.features[featureIdx].properties = rawGeojsonRef.current.features[featureIdx].properties || {};
      rawGeojsonRef.current.features[featureIdx].properties.cardcoord = wgs84ToGcj02(newCoord);
      saveGeojson(rawGeojsonRef.current);
    }
  };

  useEffect(() => {
    if (!geojson || !mapRef.current) return;
    const coords: number[][] = [];
    const collect = (g: any) => {
      if (!g) return;
      const t = g.type;
      if (t === 'Point') coords.push(g.coordinates);
      else if (['LineString', 'MultiPoint'].includes(t))
        g.coordinates.forEach((c: any) => coords.push(c));
      else if (['Polygon', 'MultiLineString'].includes(t))
        g.coordinates.flat(1).forEach((c: any) => coords.push(c));
      else if (t === 'MultiPolygon') g.coordinates.flat(2).forEach((c: any) => coords.push(c));
    };
    if (geojson.type === 'FeatureCollection')
      geojson.features.forEach((f: any) => collect(f.geometry));
    else collect(geojson.geometry || geojson);
    if (coords.length > 0) {
      const lons = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);
      const bounds: [[number, number], [number, number]] = [
        [Math.min(...lons) - 0.01, Math.min(...lats) - 0.01],
        [Math.max(...lons) + 0.01, Math.max(...lats) + 0.01],
      ];
      mapRef.current.fitBounds(bounds, { padding: 40, duration: 1000 });
    }
  }, [geojson]);

  const pointFeaturesWithIndex =
    geojson?.features
      ?.map((f: any, i: number) => ({ feature: f, originalIndex: i }))
      ?.filter(({ feature }: any) => feature.geometry?.type === 'Point') ?? [];
  
  // ================= 默认样式适配新 JSON 标准 =================
  const routesStyle = mapStyle?.route ?? {
    color: '#f97316',
    width: 4,
    style: 'straightLine' as const,
  };
  const pointsStyle = mapStyle?.point ?? {
    type: 'default' as const,
    color: '#ea580c',
  };
  const connectLineStyle = mapStyle?.connectLine ?? {
    color: '#7f3249',
    type: 'straight' as const,
    arrowDirection: 'none' as const,
  };
  const cardStyle = mapStyle?.card ?? {
    containerStyle: { width: 256, height: 180 }, // 默认宽高
    elements: {}
  };

  // 尝试从 containerStyle 提取卡片宽高，连线计算会用到
  const parsedCardWidth = parseInt(String(cardStyle.containerStyle?.width)) || 256;
  const parsedCardHeight = parseInt(String(cardStyle.containerStyle?.height)) || 180;

  return (
    <div className="flex flex-1 w-full h-full relative">
      <Map
        {...viewState}
        ref={mapRef}
        onLoad={() => setMapLoaded(true)}
        onMove={(evt) => setViewState(evt.viewState)}
        mapStyle={resolvedMapStyle ?? 'mapbox://styles/mapbox/streets-v12'}
        mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
        style={{ width: '100%', height: '100%' }}
      >
        <NavigationControl position="top-right" />

        {geojson && (
          <>
            <MainLine
              geojson={geojson}
              routesStyle={routesStyle}
              mapboxToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
            />

            {pointFeaturesWithIndex.map(({ feature, originalIndex }: any, idx: number) => {
              const [lng, lat] = feature.geometry.coordinates;
              const cardCoord: [number, number] = feature.properties.cardcoord ?? [lng + CARD_OFFSET, lat + CARD_OFFSET];
              const pointCoord: [number, number] = [lng, lat];

              return (
                <React.Fragment key={`point-group-${idx}`}>
                  <ConnectLine
                    pointCoord={pointCoord}
                    cardCoord={cardCoord}
                    connectLineStyle={connectLineStyle}
                    cardWidth={parsedCardWidth}
                    cardHeight={parsedCardHeight}
                    mapRef={mapRef}
                    mapLoaded={mapLoaded}
                    viewState={viewState}
                    index={idx}
                  />
                  <MainPoint
                    longitude={lng}
                    latitude={lat}
                    pointsStyle={pointsStyle}
                    index={idx}
                  />
                  <Marker
                    key={`card-${idx}`}
                    longitude={cardCoord[0]}
                    latitude={cardCoord[1]}
                    anchor="bottom-left"
                    draggable
                    onDragEnd={(e) => handleCardDragEnd(originalIndex, e.lngLat)}
                  >
                    <InfoCard properties={feature.properties} cardStyle={cardStyle} />
                  </Marker>
                </React.Fragment>
              );
            })}
          </>
        )}
      </Map>
    </div>
  );
};

export default CoreMap;