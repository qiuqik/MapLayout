'use client';
import React, { useState, useEffect } from 'react';
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

export interface CardStyle {
  containerStyle?: React.CSSProperties;
  elements?: {
    title?: { show?: boolean; style?: React.CSSProperties };
    desc?: { show?: boolean; style?: React.CSSProperties };
    tags?: { show?: boolean; containerStyle?: React.CSSProperties; itemStyle?: React.CSSProperties };
    category?: { show?: boolean; style?: React.CSSProperties };
    rating?: { show?: boolean; style?: React.CSSProperties };
    address?: { show?: boolean; style?: React.CSSProperties };
    openTime?: { show?: boolean; style?: React.CSSProperties };
    ticketPrice?: { show?: boolean; style?: React.CSSProperties };
    chart?: { show?: boolean; style?: React.CSSProperties };
  };
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
  cardStyle?: CardStyle;
  type?: "point";
}

const InfoCard: React.FC<InfoCardProps> = ({ properties, cardStyle, type = "point" }) => {
    if (!properties) {
        return null;
    }
    const [isMounted, setIsMounted] = useState(false);
    useEffect(() => {
        setIsMounted(true);
    }, []);

    const { title, category, desc, rating, tags, chartData, width, height } = properties;
    const elements = cardStyle?.elements || {};

    const renderChart = () => {
        if (!chartData) {
            return <div className="mt-2 p-2 bg-gray-50 rounded h-48"></div>;
        }

        const { type: chartType, title: chartTitle, xAxis, series } = chartData;
        let option = {};

        switch (chartType) {
            case 'pie':
                option = {
                    tooltip: { trigger: 'item', textStyle: { fontSize: 10 } },
                    series: [{
                        name: chartTitle || '占比',
                        type: 'pie',
                        radius: ['30%', '50%'],
                        data: series.map(s => ({ value: s.value, name: s.name })),
                    }],
                };
                break;
            case 'bar':
                option = {
                    tooltip: { trigger: 'axis', textStyle: { fontSize: 10 } },
                    grid: { left: '10%', right: '10%', top: '10%', bottom: '20%', containLabel: true },
                    xAxis: { type: 'category', data: xAxis || [], axisLabel: { fontSize: 9 } },
                    yAxis: { type: 'value', axisLabel: { fontSize: 9 } },
                    series: series.map(s => ({
                        name: s.title,
                        type: 'bar',
                        data: s.data,
                        itemStyle: { color: '#3b82f6' },
                    })),
                };
                break;
            case 'line':
                option = {
                    tooltip: { trigger: 'axis', textStyle: { fontSize: 10 } },
                    grid: { left: '10%', right: '10%', top: '10%', bottom: '20%', containLabel: true },
                    xAxis: { type: 'category', data: xAxis || [], axisLabel: { fontSize: 9 } },
                    yAxis: { type: 'value', axisLabel: { fontSize: 9 } },
                    series: series.map(s => ({
                        name: s.title,
                        type: 'line',
                        data: s.data,
                        smooth: true,
                        lineStyle: { color: '#ef4444', width: 2 },
                    })),
                };
                break;
            default:
                return <div className="mt-2 p-2 bg-gray-50 rounded h-48"></div>;
        }

        return (
            <div className="mt-2 p-2 rounded" style={{ backgroundColor: 'rgba(0,0,0,0.02)', ...elements.chart?.style }}>
                <p className="text-xs font-semibold text-gray-700 mb-2">{chartTitle}</p>
                {isMounted && (
                    <ReactECharts
                        option={option}
                        style={{ width: '100%', height: '180px' }}
                        opts={{ renderer: 'svg'}}
                    />
                )}
            </div>
        );
    };

    // 托底样式
    const containerBaseStyle: React.CSSProperties = {
        backgroundColor: '#ffffff',
        width: width ?? 256,
        minHeight: height ?? 180,
        ...cardStyle?.containerStyle
    };

    return (
        <div
            className="rounded-lg shadow-lg p-3 box-border flex flex-col"
            style={containerBaseStyle}
        >
            <div className="mb-2 flex items-center flex-wrap gap-2">
                {/* 标题 */}
                {elements.title?.show && title && (
                    <div className="text-sm font-bold m-0" style={{color: '#1e293b', ...elements.title.style }}>
                        {title}
                    </div>
                )}
                
                {/* 分类 */}
                {elements.category?.show && category && (
                    <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: '#eff6ff', color: '#2563eb', ...elements.category.style }}>
                        {category}
                    </span>
                )}
                
                {/* 评分 */}
                {elements.rating?.show && rating && (
                    <span className="text-xs" style={{ color: '#ca8a04', ...elements.rating.style }}>
                        ⭐ {rating}
                    </span>
                )}
            </div>

            {/* 描述 */}
            {elements.desc?.show && desc && (
                <p className="text-xs mb-2 leading-relaxed" style={{ color: '#374151', ...elements.desc.style }}>
                    {desc}
                </p>
            )}

            {/* 标签 */}
            {elements.tags?.show && tags && tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2" style={elements.tags.containerStyle}>
                    {tags.slice(0, 3).map((tag, idx) => (
                        <span 
                            key={idx} 
                            className="text-xs px-2 py-0.5 rounded" 
                            style={{ backgroundColor: 'rgba(0,0,0,0.06)', color: '#374151', ...elements.tags?.itemStyle }}
                        >
                            {tag}
                        </span>
                    ))}
                </div>
            )}

            {/* 图表 */}
            {elements.chart?.show && renderChart()}

            {/* 地址、时间、价格 */}
            {(elements.address?.show || elements.openTime?.show || elements.ticketPrice?.show) && (
                <div className="mt-auto pt-2 space-y-1 text-xs" style={{ borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                    {elements.address?.show && properties.address && (
                        <p style={{ color: '#4b5563', ...elements.address.style }}>
                            <span className="font-semibold mr-1">📍</span> {properties.address}
                        </p>
                    )}
                    {elements.openTime?.show && properties.openTime && (
                        <p style={{ color: '#4b5563', ...elements.openTime.style }}>
                            <span className="font-semibold mr-1">🕐</span> {properties.openTime}
                        </p>
                    )}
                    {elements.ticketPrice?.show && properties.ticketPrice && (
                        <p style={{ color: '#4b5563', ...elements.ticketPrice.style }}>
                            <span className="font-semibold mr-1">🎫</span> {properties.ticketPrice}
                        </p>
                    )}
                </div>
            )}
        </div>
    )
}

export default InfoCard;