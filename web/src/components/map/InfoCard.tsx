'use client';
import React, { useState, useEffect, useRef, useContext } from 'react';
import mapboxgl from 'mapbox-gl';
import { MapContextType, MapDataContext } from '@/lib/mapContext'
import ReactECharts from 'echarts-for-react';


interface ChartData {
  type: "bar" | "line" | "pie";
  title?: string;
  xAxis?: string[];
  series: Array<{
    title: string;
    data: number[];
    name: string;
    value: number;
  }>;
}

interface InfoCardProps {
  properties: {
    name?: string;
    title?: string;
    category?: string;
    desc?: string;
    address?: string;
    openTime?: string;
    ticketPrice?: string;
    rating?: number;
    tags?: string[];
    chartData?: ChartData;
    [key: string]: any;
  };
  type?: "point";
}

const InfoCard: React.FC<InfoCardProps> = ({properties, type = "point"}) => {
    if (!properties) {
        return null;
    }

    const { title, category, desc, rating, tags, chartData } = properties;

    const renderChart = () => {
        if (!chartData) return null;

        const { type: chartType, title: chartTitle, xAxis, series } = chartData;

        switch (chartType) {
            case 'pie':
                return (
                    <div className="mt-2 p-2 bg-gray-50 rounded">
                        <p className="text-xs font-semibold text-gray-700 mb-2">{chartTitle}</p>
                        <ReactECharts
                            key={`pie-${chartTitle}`}
                            option={{
                                tooltip: { trigger: 'item', textStyle: { fontSize: 10 } },
                                // legend: { orient: 'vertical', left: 'left', textStyle: { fontSize: 9 } },
                                grid: undefined,
                                xAxis: undefined,
                                yAxis: undefined,
                                series: [
                                    {
                                        name: chartTitle || '占比',
                                        type: 'pie',
                                        radius: ['30%', '50%'],
                                        data: series.map((s) => ({
                                            value: s.value,
                                            name: s.name,
                                        })),
                                        emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.5)' } },
                                    },
                                ],
                            }}
                            style={{ width: '100%', height: '180px' }}
                            opts={{ renderer: 'svg'}}
                        />
                    </div>
                );

            case 'bar':
                return (
                    <div className="mt-2 p-2 bg-gray-50 rounded">
                        <p className="text-xs font-semibold text-gray-700 mb-2">{chartTitle}</p>
                        <ReactECharts
                            key={`bar-${chartTitle}`}
                            option={{
                                tooltip: { trigger: 'axis', textStyle: { fontSize: 10 } },
                                grid: { left: '10%', right: '10%', top: '10%', bottom: '20%', containLabel: true },
                                xAxis: {
                                    type: 'category',
                                    data: xAxis || [],
                                    axisLabel: { fontSize: 9 },
                                },
                                yAxis: {
                                    type: 'value',
                                    axisLabel: { fontSize: 9 },
                                },
                                series: series.map((s) => ({
                                    name: s.title,
                                    type: 'bar',
                                    data: s.data,
                                    itemStyle: { color: '#3b82f6' },
                                    emphasis: { itemStyle: { color: '#1d4ed8' } },
                                })),
                            }}
                            style={{ width: '100%', height: '180px' }}
                            opts={{ renderer: 'svg'}}
                        />
                    </div>
                );

            case 'line':
                return (
                    <div className="mt-2 p-2 bg-gray-50 rounded">
                        <p className="text-xs font-semibold text-gray-700 mb-2">{chartTitle}</p>
                        <ReactECharts
                            key={`line-${chartTitle}`}
                            option={{
                                tooltip: { trigger: 'axis', textStyle: { fontSize: 10 } },
                                grid: { left: '10%', right: '10%', top: '10%', bottom: '20%', containLabel: true },
                                xAxis: {
                                    type: 'category',
                                    data: xAxis || [],
                                    axisLabel: { fontSize: 9 },
                                },
                                yAxis: {
                                    type: 'value',
                                    axisLabel: { fontSize: 9 },
                                },
                                series: series.map((s) => ({
                                    name: s.title,
                                    type: 'line',
                                    data: s.data,
                                    smooth: true,
                                    lineStyle: { color: '#ef4444', width: 2 },
                                    itemStyle: { color: '#dc2626', borderWidth: 2, borderColor: '#fff' },
                                    areaStyle: { color: 'rgba(239, 68, 68, 0.2)' },
                                    emphasis: { itemStyle: { color: '#991b1b' } },
                                })),
                            }}
                            style={{ width: '100%', height: '180px' }}
                            opts={{ renderer: 'svg'}}
                        />
                    </div>
                );

            default:
                return null;
        }
    };

    return (
        <div className='w-64 bg-white rounded-lg shadow-lg p-3 border border-gray-200'>
            {/* 标题和分类 */}
            <div className="mb-2">
                <h3 className="text-sm font-bold text-gray-900 mb-1">{title}</h3>
                {category && (
                    <p className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded inline-block">
                        {category}
                    </p>
                )}
                {rating && (
                    <div className="text-xs text-yellow-600 ml-2 inline-block">
                        ⭐ {rating}
                    </div>
                )}
            </div>

            {/* 描述 */}
            {desc && (
                <p className="text-xs text-gray-700 mb-2 line-clamp-2">{desc}</p>
            )}

            {/* 标签 */}
            {tags && tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                    {tags.slice(0, 3).map((tag, idx) => (
                        <span key={idx} className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">
                            {tag}
                        </span>
                    ))}
                </div>
            )}

            {/* 图表 */}
            {renderChart()}

            {/* 其他信息 */}
            <div className="mt-2 pt-2 border-t border-gray-100 space-y-1 text-xs text-gray-600">
                {properties.address && (
                    <p><span className="font-semibold">📍</span> {properties.address}</p>
                )}
                {properties.openTime && (
                    <p><span className="font-semibold">🕐</span> {properties.openTime}</p>
                )}
                {properties.ticketPrice && (
                    <p><span className="font-semibold">🎫</span> {properties.ticketPrice}</p>
                )}
            </div>
        </div>
    )
}

export default InfoCard;