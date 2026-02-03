'use client';
import React, { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';


const CoreMap = () => {
    const mapContainerRef = useRef(null);
    const mapRef = useRef(null);
    useEffect(() => {
        if(mapRef.current) return;
        if(mapContainerRef.current){
            mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
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
    return (
        <div id="map" className='fixed inset-0 w-screen h-screen' ref={mapContainerRef} />
    );
}

export default CoreMap;