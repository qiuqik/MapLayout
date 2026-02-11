import React, { useEffect, useState, useContext } from 'react';
import { Button } from "@/components/ui/button"
import { ArrowUpIcon } from "lucide-react"

import { MapDataContext } from '@/lib/mapContext'

const LeftCard = () => {
    const [files, setFiles] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const { geojson, setGeojson } = useContext(MapDataContext);

    useEffect(() => {
        fetch('http://localhost:8000/files')
            .then(res => res.json())
            .then(data => {
                if (data && data.files) setFiles(data.files);
            })
            .catch(err => console.error(err));
    }, [geojson]);

    const handleClick = async (name: string) => {
        setLoading(true);
        try {
            const res = await fetch(`http://localhost:8000/files/${encodeURIComponent(name)}`);
            const json = await res.json();
            setGeojson(json);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="absolute top-8 left-0 w-[21%] h-[100%] z-10 bg-white/100 shadow-lg p-2 overflow-auto">
            <div className="mt-2">
                <h3 className="text-sm font-medium mb-2">历史 GeoJSON 文件</h3>
                {files.length === 0 && <div className="text-xs text-gray-500">暂无文件</div>}
                <ul className="space-y-1">
                    {files.map(f => (
                        <li key={f}>
                            <button
                                className="w-full text-left px-2 py-1 rounded hover:bg-gray-100"
                                onClick={() => handleClick(f)}
                                disabled={loading}
                            >
                                {f}
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    )
};

export default LeftCard;