import React, { useEffect, useState, useContext } from 'react';
import { MapDataContext } from '@/lib/mapContext'


const RightCard = () => {
    const { geofilename, geojson } = useContext(MapDataContext);
    const [geojsonString, setGeojsonString] = useState(geojson ? JSON.stringify(geojson, null, 2) : '暂无数据');
    // const geojsonString = geojson ? JSON.stringify(geojson, null, 2) : '暂无数据';

    useEffect(() => {
        setGeojsonString(geojson ? JSON.stringify(geojson, null, 2) : '暂无数据');
    }, [geojson]);

    return (
        <div className="absolute top-7 right-0 w-[22%] h-[100%] z-10 bg-white/100 shadow-lg p-4">
            <h3 className="font-bold mb-2">Info: {geofilename}</h3>
            <div className="h-[calc(100%-40px)] overflow-auto bg-gray-50">
                <pre className="text-xs font-mono p-4 text-gray-800 leading-relaxed">
                    {geojsonString}
                </pre>
            </div>
        </div>
    )
    
};

export default RightCard;