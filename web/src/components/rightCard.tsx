import React, { useEffect, useState, useContext } from 'react';
import { MapDataContext } from '@/lib/mapContext'
import { X } from 'lucide-react'


const RightCard: React.FC = () => {
    const { 
        geofilename, 
        imagename, 
        setGeofilename, 
        setImagename 
    } = useContext(MapDataContext);
    const [geojson, setGeojson] = useState(null);

    useEffect(() => {
        if(!geofilename) return;
        try {
            fetch(`http://localhost:8000/files/${encodeURIComponent(geofilename)}`)
                .then(res => res.json())
                .then(data => {
                    setGeojson(data);
                })
        } catch (e) {
            console.error(e);
        }
    }, [geofilename])

    // 删除图片
    const handleDeleteImage = () => {
        setImagename(null);
    };

    return (
        <div className="flex flex-col flex-shrink-0 w-[22%] h-full bg-white/100 shadow-lg p-4 z-10 overflow-hidden">
            <h3 className="font-bold mb-2">Info:</h3>
            
            {/* 图片部分 */}
            {imagename && (
                <div className="mb-4 flex-shrink-0 relative group">
                    <img 
                        src={imagename ? `http://localhost:8000/files/${encodeURIComponent(imagename)}` : ''} 
                        alt="reference"
                        className="w-full h-auto rounded border border-gray-200"
                    />
                    <button
                        onClick={handleDeleteImage}
                        className="absolute top-1 right-1 bg-red-500 hover:bg-red-600 text-white rounded-full p-0 w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        title="删除图片"
                    >
                        <X size={14} />
                    </button>
                </div>
            )}
            
            <div className="font-normal text-sm truncate"> {geofilename} </div>
            <div className="flex-1 overflow-auto bg-gray-50 mt-2 min-h-0">
                <pre className="text-xs font-mono p-4 text-gray-800 leading-relaxed">
                    {geojson ? JSON.stringify(geojson, null, 2) : '暂无数据'}
                </pre>
            </div>
        </div>
    )
    
};

export default RightCard;