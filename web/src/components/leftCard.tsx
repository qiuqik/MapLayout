import React, { useEffect, useState, useContext } from 'react';
import { Button } from "@/components/ui/button"
import { ArrowUpIcon } from "lucide-react"
import { Separator } from "@/components/ui/separator"

import { MapDataContext } from '@/lib/mapContext'
import ChatDialog from '@/components/ChatDialog';


const LeftCard: React.FC = () => {
    const [geofiles, setGeofiles] = useState<string[]>([]);
    const [stylefiles, setStylefiles] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const { geofilename, stylename, setGeofilename, setStylename } = useContext(MapDataContext);

    useEffect(() => {
        fetch('http://localhost:8000/geofiles')
            .then(res => res.json())
            .then(data => {
                // 按照文件名称排序
                data.files.sort((a: string, b: string) => {
                    return a.localeCompare(b);
                });
                if (data && data.files) {
                    setGeofiles(data.files);
                }
            })
            .catch(err => console.error(err));
    }, []);

    useEffect(() => {
        fetch('http://localhost:8000/stylefiles')
            .then(res => res.json())
            .then(data => {
                data.files.sort((a: string, b: string) => {
                    return a.localeCompare(b);
                });
                if (data && data.files) {
                    setStylefiles(data.files);
                }
            })
            .catch(err => console.error(err));
    }, []);

    const handleClickGeo = async (name: string) => {
        setGeofilename(name);
    }
    const handleClickStyle = async (name: string) => {
        setStylename(name);
    }

    return (
        <div className="flex flex-col flex-shrink-0 w-[21%] h-full bg-white/100 shadow-lg p-2 overflow-hidden z-10">
            <div className="mt-2">
                <ChatDialog />
            </div>
            <Separator className="my-4" />
            <h3 className="text-sm font-medium mb-1">历史 GeoJSON 文件</h3>
            <div className="mt-2 h-[30%] overflow-auto flex-shrink-0">
                {geofiles.length === 0 && <div className="text-xs text-gray-500">暂无文件</div>}
                <ul className="space-y-1 overflow-auto">
                    {geofiles.map(f => (
                        <li key={f}>
                            <button
                                className="w-full text-sm text-left px-2 py-1 rounded hover:bg-gray-100"
                                style={{ backgroundColor: geofilename === f ? '#f0f0f0' : 'transparent' }}
                                onClick={() => handleClickGeo(f)}
                                disabled={loading}
                            >
                                {f}
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
            <Separator className="my-4" />
            <h3 className="text-sm font-medium mb-1">历史 StyleJSON 文件</h3>
            <div className="mt-2 h-[30%] overflow-auto flex-shrink-0">
                {stylefiles.length === 0 && <div className="text-xs text-gray-500">暂无文件</div>}
                <ul className="space-y-1 overflow-auto">
                    {stylefiles.map(f => (
                        <li key={f}>
                            <button
                                className="w-full text-sm text-left px-2 py-1 rounded hover:bg-gray-100"
                                style={{ backgroundColor: stylename === f ? '#f0f0f0' : 'transparent' }}
                                onClick={() => handleClickStyle(f)}
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