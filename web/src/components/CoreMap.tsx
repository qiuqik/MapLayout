'use client';
import React, { useState, useEffect, useRef, useContext, useMemo } from 'react';
import 'mapbox-gl/dist/mapbox-gl.css';
import Map, { Source, Layer, NavigationControl, MapRef, LayerProps, Marker } from 'react-map-gl/mapbox';
import { MapDataContext } from '@/lib/mapContext';
import { gcj02ToWgs84 } from '@/lib/gcl2wgs';
import dynamic from 'next/dynamic';


const InfoCard = dynamic(() => import('./map/InfoCard'), { 
  ssr: false,
});

// 定义图层样式
const lineLayerStyle: LayerProps = {
    id: 'selected-line',
    type: 'line',
    paint: { 'line-color': '#0f172a', 'line-width': 2 },
};

const circleLayerStyle: LayerProps = {
    id: 'selected-circle',
    type: 'circle',
    paint: { 'circle-radius': 6, 'circle-color': '#ef4444' },
};

const CoreMap: React.FC = () => {
    const { geofilename } = useContext(MapDataContext);
    const mapRef = useRef<MapRef>(null);
    
    const [geojson, setGeojson] = useState<any>(null);
    const [mapStyle, setMapStyle] = useState<any>(null);
    const [viewState, setViewState] = useState({
        longitude: 116.4074,
        latitude: 39.9042,
        zoom: 12
    });

    // 加载本地地图样式
    useEffect(() => {
        const fetchMapStyle = async () => {
            try {
                const res = await fetch('/mapbox_style_000.json');
                const data = await res.json();
                setMapStyle(data);
            } catch (error) {
                console.error('加载本地样式失败，使用默认样式:', error);
                setMapStyle('mapbox://styles/mapbox/streets-v12');
            }
        };
        fetchMapStyle();
    }, []);

    // 坐标转换逻辑
    const coordinateTrans = (geodata: any): any => {
        if (!geodata?.features) {
            return geodata; 
        }
        const newGeodata = JSON.parse(JSON.stringify(geodata));
        for(var i = 0; i < geodata.features.length; i++){
            if(geodata.features[i].geometry.type === "LineString") {
                var coords = geodata.features[i].geometry.coordinates;
                for(var j = 0; j < coords.length; j++)
                {
                    newGeodata.features[i].geometry.coordinates[j] = gcj02ToWgs84(coords[j]);
                }
            } 
            else if(geodata.features[i].geometry.type === "Point"){
                var coord = gcj02ToWgs84(geodata.features[i].geometry.coordinates);
                newGeodata.features[i].properties.coordinates = coord;
                newGeodata.features[i].geometry.coordinates = coord;
            }
        }
        return newGeodata;
    };

    // 获取并转换 GeoJSON
    useEffect(() => {
        if (!geofilename) return;
        const fetchGeoJson = async () => {
            try {
                const res = await fetch(`http://localhost:8000/files/${encodeURIComponent(geofilename)}`);
                const data = await res.json();
                const transformedData = coordinateTrans(data);
                setGeojson(transformedData);
            } catch (e) {
                console.error("Fetch GeoJSON Error:", e);
            }
        };
        fetchGeoJson();
    }, [geofilename]);

    // 当数据变化时自动缩放 (fitBounds)
    useEffect(() => {
        if (!geojson || !mapRef.current) return;

        const coords: number[][] = [];
        const collect = (g: any) => {
            if (!g) return;
            const t = g.type;
            if (t === 'Point') coords.push(g.coordinates);
            else if (['LineString', 'MultiPoint'].includes(t)) g.coordinates.forEach((c: any) => coords.push(c));
            else if (['Polygon', 'MultiLineString'].includes(t)) g.coordinates.flat(1).forEach((c: any) => coords.push(c));
            else if (t === 'MultiPolygon') g.coordinates.flat(2).forEach((c: any) => coords.push(c));
        };

        if (geojson.type === 'FeatureCollection') geojson.features.forEach((f: any) => collect(f.geometry));
        else collect(geojson.geometry || geojson);

        if (coords.length > 0) {
            const lons = coords.map(c => c[0]);
            const lats = coords.map(c => c[1]);
            const bounds: [[number, number], [number, number]] = [
                [Math.min(...lons) - 0.01, Math.min(...lats) - 0.01],
                [Math.max(...lons) + 0.01, Math.max(...lats) + 0.01]
            ];

            mapRef.current.fitBounds(bounds, { padding: 40, duration: 1000 });
        }
    }, [geojson]);

    return (
        <div className="flex flex-1 w-full h-full relative">
            <Map
                {...viewState}
                ref={mapRef}
                onMove={evt => setViewState(evt.viewState)}
                mapStyle={mapStyle}
                mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
                style={{ width: '100%', height: '100%' }}
            >
                <NavigationControl position="top-right" />

                {geojson && (
                    <>
                        <Source id="selected-data" type="geojson" data={geojson}>
                            <Layer {...lineLayerStyle} />
                            <Layer {...circleLayerStyle} />
                        </Source>

                        {/* 渲染卡片 */}
                        {geojson.features?.map((feature: any, idx: number) => {
                            if(feature.geometry.type === 'Point') {
                                const [longitude, latitude] = feature.geometry.coordinates;
                                return (
                                    <Marker 
                                        key={idx}
                                        anchor="bottom"
                                        longitude={longitude}
                                        latitude={latitude}
                                    >
                                        <InfoCard properties={feature.properties} />
                                    </Marker>
                                )
                            }
                        })}
                    </>
                )}
            </Map>
        </div>
    );
};

export default CoreMap;