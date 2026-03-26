'use client';

import { Source, Layer } from 'react-map-gl/mapbox';

interface AreaRendererProps {
  areaStyles: any[];
  transformedLayers: any;
}

const AreaRenderer: React.FC<AreaRendererProps> = ({ areaStyles, transformedLayers }) => {
  
  // 核心解析函数
  const parseHexColor = (hex: string, defaultOpacity: any) => {
    if (!hex || hex === 'none') return { color: 'rgba(0,0,0,0)', opacity: 0 };
    
    let color = hex;
    let opacity = defaultOpacity === 'none' || defaultOpacity === undefined ? 1 : Number(defaultOpacity);

    // 匹配 #RRGGBBAA 格式 (9位字符)
    if (/^#([A-Fa-f0-9]{8})$/.test(hex)) {
      color = hex.substring(0, 7); // 提取 #RRGGBB
      const alphaHex = hex.substring(7, 9); // 提取最后两位 AA
      opacity = parseInt(alphaHex, 16) / 255; // 8位色值的透明度优先级更高
    }

    return { color, opacity };
  };

  return (
    <>
      {areaStyles.map((areaStyle: any) => {
        const areaFeatures = transformedLayers.features.filter((f: any) => 
          f.geometry?.type === 'Polygon' && f.properties?.visual_id === areaStyle.visual_id
        );
        
        if (areaFeatures.length === 0) return null;

        // 解析背景色和透明度
        const bg = parseHexColor(areaStyle.backgroundColor, areaStyle.opacity);
        // 解析边框色（假设边框不共用 opacity 逻辑，或者你可以根据需求调整）
        const border = parseHexColor(areaStyle.borderColor, 1);

        return (
          <Source 
            key={areaStyle.visual_id} 
            id={`area-${areaStyle.visual_id}`} 
            type="geojson" 
            data={{
              type: 'FeatureCollection',
              features: areaFeatures
            }}
          >
            <Layer
              id={areaStyle.visual_id}
              type="fill"
              paint={{
                'fill-color': bg.color,
                'fill-opacity': bg.opacity,
                'fill-outline-color': border.color,
              }}
            />
          </Source>
        );
      })}
    </>
  );
};

export default AreaRenderer;