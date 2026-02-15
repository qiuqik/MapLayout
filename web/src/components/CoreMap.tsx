'use client';
import React, { useState, useEffect, useRef, useContext } from 'react';
import mapboxgl from 'mapbox-gl';
import { MapContextType, MapDataContext } from '@/lib/mapContext'
import { gcj02ToWgs84 } from '@/lib/gcl2wgs'


const CoreMap = () => {
    const { 
            geofilename, 
            setGeofilename,
        } = useContext(MapDataContext);
    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<any>(null);
    const [geojson, setGeojson] = useState(null);
    const [mapStyle, setMapStyle] = useState(null);
    const [isMapLoaded, setIsMapLoaded] = useState<boolean>(false); 

    useEffect(() => {
        if(!geofilename) return;
        const fetchGeoJson = async () => {
            try {
                fetch(`http://localhost:8000/files/${encodeURIComponent(geofilename)}`)
                    .then(res => res.json())
                    .then(data => {
                        setGeojson(data);
                        // 转换坐标
                        const transformedData = CoordinateTrans(data);
                        setGeojson(transformedData);
                    })
            } catch (e) {
                console.error(e);
            }
        };
        fetchGeoJson();
    }, [geofilename])
    
    // 加载地图样式
    useEffect(() => {
        const fetchMapStyle = async () => {
            try {
                const res = await fetch('/mapbox_style_000.json');
                const data = await res.json();
                setMapStyle(data);
            } catch (error) {
                console.error('加载本地样式失败，使用默认样式:', error);
                setMapStyle('mapbox://styles/mapbox/streets-v12?language=zh');
            }
        };
        fetchMapStyle();
    }, []);

    useEffect(() => {
        if (mapRef.current || !mapStyle || !mapContainerRef.current) return;
        
        if(mapContainerRef.current){
            mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN as string;
            if (!mapboxgl.accessToken) {
                console.error("Mapbox Token 未配置！请检查 .env 文件");
                return;
            }
            // 创建地图实例
            const map = new mapboxgl.Map({
                container: mapContainerRef.current,
                style: mapStyle,
                center: [116.4074, 39.9042],
                zoom: 12,
            });
            map.on('style.load', () => {
                console.log('地图样式加载完成');
                setIsMapLoaded(true);
            });
            map.on('error', (e) => {
                console.error('地图加载错误:', e);
            });
            mapRef.current = map;
        }
        return () => {
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
                setIsMapLoaded(false);
            }
        };
    }, [mapStyle]);
     
    const CoordinateTrans = (geodata: any): any => {
        if (!geodata?.features) {
            return geodata; 
        }
        let newGeodata = geodata;
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
    }

    // 更新 source/layer 并缩放到数据范围
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !geojson || !isMapLoaded) return;


        const sourceId = 'selected-data';
        try {
            if (map.getSource && map.getSource(sourceId)) {
                // @ts-ignore
                map.getSource(sourceId).setData(geojson);
            } else {
                map.addSource(sourceId, { 
                    type: 'geojson', 
                    data: geojson 
                });

                // 添加线图层
                if (!map.getLayer('selected-line')) {
                    map.addLayer({
                        id: 'selected-line',
                        type: 'line',
                        source: sourceId,
                        paint: { 'line-color': '#0f172a', 'line-width': 2 },
                    });
                }
                // 添加点图层
                if (!map.getLayer('selected-circle')) {
                    map.addLayer({
                        id: 'selected-circle',
                        type: 'circle',
                        source: sourceId,
                        paint: { 'circle-radius': 6, 'circle-color': '#ef4444' },
                    });
                }
            }

            // 计算 bounds 并 fit
            const coords: number[][] = [];
            const collect = (g: any) => {
                if (!g) return;
                const t = g.type;
                if (t === 'Point') coords.push(g.coordinates);
                else if (t === 'LineString' || t === 'MultiPoint') 
                    g.coordinates.forEach((c: number[]) => coords.push(c));
                else if (t === 'Polygon' || t === 'MultiLineString') 
                    g.coordinates.flat(1).forEach((c: number[]) => coords.push(c));
                else if (t === 'MultiPolygon') 
                    g.coordinates.flat(2).forEach((c: number[]) => coords.push(c));
            }
            if (geojson.type === 'FeatureCollection') {
                geojson.features.forEach((f: any) => collect(f.geometry));
            } else if (geojson.type === 'Feature') {
                collect(geojson.geometry);
            } else {
                collect(geojson);
            }

            if (coords.length > 0) {
                const minX = Math.min(...coords.map(c => c[0]));
                const minY = Math.min(...coords.map(c => c[1]));
                const maxX = Math.max(...coords.map(c => c[0]));
                const maxY = Math.max(...coords.map(c => c[1]));

                // 增加一点缓冲
                const padding = 0.025;
                const sw = [minX - padding, minY - padding];
                const ne = [maxX + padding, maxY + padding];
                try {
                    map.fitBounds([sw, ne], { padding: 40, maxZoom: 15, duration: 1000 });
                } catch (e) {
                    console.warn('fitBounds 失败', e);
                }
            }
        } catch (e) {
            console.error('绘制 geojson 失败', e);
        }

    }, [geojson, isMapLoaded]);

    return (
        <div 
            id="map" 
            className='fixed inset-0 w-screen h-screen' 
            ref={mapContainerRef} 
        />
    );
}

export default CoreMap;