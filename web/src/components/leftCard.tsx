import React, { useEffect, useState, useContext } from 'react';
import { Button } from "@/components/ui/button"
import { ArrowUpIcon } from "lucide-react"
import { Separator } from "@/components/ui/separator"

import { MapDataContext } from '@/lib/mapContext'
import ChatDialog from '@/components/ChatDialog';


const LeftCard = () => {
    const [files, setFiles] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const { geofilename, setGeofilename } = useContext(MapDataContext);

    useEffect(() => {
        fetch('http://localhost:8000/geofiles')
            .then(res => res.json())
            .then(data => {
                if (data && data.files) setFiles(data.files);
            })
            .catch(err => console.error(err));
    }, [geofilename]);

    const handleClick = async (name: string) => {
        setGeofilename(name);
    }

    return (
        <div className="absolute top-8 left-0 w-[21%] h-[100%] z-10 bg-white/100 shadow-lg p-2">
            <div className="mt-2">
                <ChatDialog />
            </div>
            <Separator className="my-4" />
            <div className="mt-2 h-[50%] overflow-auto">
                <h3 className="text-sm font-medium mb-2">历史 GeoJSON 文件</h3>
                {files.length === 0 && <div className="text-xs text-gray-500">暂无文件</div>}
                <ul className="space-y-1">
                    {files.map(f => (
                        <li key={f}>
                            <button
                                className="w-full text-sm text-left px-2 py-1 rounded hover:bg-gray-100"
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