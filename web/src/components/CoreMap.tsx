'use client';
import React, { useEffect, useRef, useContext } from 'react';
import mapboxgl from 'mapbox-gl';
import { MapContextType, MapDataContext } from '@/lib/mapContext'
import { gcj02ToWgs84 } from '@/lib/gcl2wgs'


const CoreMap = () => {
    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<any>(null);
    const { geojson, setGeojson } = useContext(MapDataContext);

    useEffect(() => {
        if(mapRef.current) return;
        if(mapContainerRef.current){
            mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN as string;
            if (!mapboxgl.accessToken) {
                console.error("Mapbox Token 未配置！请检查 .env 文件");
                return;
            }
            mapRef.current = new mapboxgl.Map({
                container: mapContainerRef.current,
                style: 'mapbox://styles/mapbox/streets-v12',
                center: [116.4074, 39.9042],
                zoom: 12,
            });
            mapRef.current.on('load', () => {
                console.log('地图加载完成');
            });
        }
        return () => {
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
        };
    }, []);
     
    const CoordinateTrans = (geodata: MapContextType["geojson"]): MapContextType["geojson"] => {
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

    // 当 geojson 更新时，添加或更新 source/layer 并缩放到数据范围
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !geojson) return;
        setGeojson(CoordinateTrans(geojson));
        if(!geojson) return;


        const sourceId = 'selected-data';
        try {
            if (map.getSource && map.getSource(sourceId)) {
                // @ts-ignore
                map.getSource(sourceId).setData(geojson);
            } else {
                map.addSource(sourceId, { type: 'geojson', data: geojson });
                // add generic layers: fill, line, circle
                // if (!map.getLayer('selected-fill')) {
                //     map.addLayer({
                //         id: 'selected-fill',
                //         type: 'fill',
                //         source: sourceId,
                //         paint: { 'fill-color': '#06b6d4', 'fill-opacity': 0.4 },
                //     });
                // }
                if (!map.getLayer('selected-line')) {
                    map.addLayer({
                        id: 'selected-line',
                        type: 'line',
                        source: sourceId,
                        paint: { 'line-color': '#0f172a', 'line-width': 2 },
                    });
                }
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
                else if (t === 'LineString' || t === 'MultiPoint') g.coordinates.forEach((c: number[]) => coords.push(c));
                else if (t === 'Polygon' || t === 'MultiLineString') g.coordinates.flat(1).forEach((c: number[]) => coords.push(c));
                else if (t === 'MultiPolygon') g.coordinates.flat(2).forEach((c: number[]) => coords.push(c));
            }
            if (geojson.type === 'FeatureCollection') {
                geojson.features.forEach((f: any) => collect(f.geometry));
            } else if (geojson.type === 'Feature') {
                collect(geojson.geometry);
            } else {
                collect(geojson);
            }

            if (coords.length > 0) {

                let minX = coords[0][0], minY = coords[0][1], maxX = coords[0][0], maxY = coords[0][1];
                coords.forEach(c => {
                    if (c[0] < minX) minX = c[0];
                    if (c[1] < minY) minY = c[1];
                    if (c[0] > maxX) maxX = c[0];
                    if (c[1] > maxY) maxY = c[1];
                });
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

    }, [geojson]);

    return (
        <div id="map" className='fixed inset-0 w-screen h-screen' ref={mapContainerRef} />
    );
}

export default CoreMap;