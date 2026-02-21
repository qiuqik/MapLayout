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
  borderColor?: string;
  backgroundColor?: string;
  textColor?: string;
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

    const { title, category, desc, rating, tags, chartData } = properties;

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
            <div className="mt-2 p-2 bg-gray-50 rounded">
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

    const borderStyle = cardStyle?.borderColor && cardStyle.borderColor !== 'none'
      ? { borderWidth: 1, borderStyle: 'solid' as const, borderColor: cardStyle.borderColor }
      : { border: 'none' };
    const containerStyle = {
      backgroundColor: cardStyle?.backgroundColor ?? '#ffffff',
      color: cardStyle?.textColor ?? '#1e293b',
      ...borderStyle,
    };

    return (
        <div
          className="w-64 rounded-lg shadow-lg p-3"
          style={containerStyle}
        >
            <div className="mb-2">
                <h3 className="text-sm font-bold mb-1" style={{ color: cardStyle?.textColor ?? '#1e293b' }}>{title}</h3>
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

            {desc && (
                <p className="text-xs mb-2 line-clamp-2" style={{ color: cardStyle?.textColor ?? '#374151' }}>{desc}</p>
            )}

            {tags && tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                    {tags.slice(0, 3).map((tag, idx) => (
                        <span key={idx} className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'rgba(0,0,0,0.06)', color: cardStyle?.textColor ?? '#374151' }}>
                            {tag}
                        </span>
                    ))}
                </div>
            )}

            {/* {renderChart()} */}

            <div className="mt-2 pt-2 border-t space-y-1 text-xs" style={{ borderColor: 'rgba(0,0,0,0.08)', color: cardStyle?.textColor ?? '#4b5563' }}>
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