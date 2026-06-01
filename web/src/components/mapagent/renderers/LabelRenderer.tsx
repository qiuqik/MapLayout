'use client';

import { Marker } from 'react-map-gl/mapbox';
import { populateTemplate } from '../utils/mapUtils';

interface LabelRendererProps {
  points: any[];
  labelStyles: any[];
  globalProps: any;
  labelScale?: number;
  hideDetailLabels?: boolean;
}

const isDetailLabel = (feature: any, style: any) => {
  const hierarchy = feature.properties?.label_hierarchy || feature.properties?.hierarchy || style?.hierarchy;
  return hierarchy === 'detail' || hierarchy === '详细标签';
};

const LabelRenderer: React.FC<LabelRendererProps> = ({ points, labelStyles, globalProps, labelScale = 1, hideDetailLabels = false }) => {
  return (
    <>
      {points.map((feature: any) => {
        const labelStyle = labelStyles.find(
          (l: any) => l.visual_id === feature.properties?.label_visual_id
        );
        if (!labelStyle) return null;
        if (hideDetailLabels && isDetailLabel(feature, labelStyle)) return null;

        const coord = feature.properties?.label_coord || feature.geometry.coordinates;
        const [lng, lat] = coord;
        const htmlStr = populateTemplate(labelStyle.template, feature.properties, globalProps);
        const visualScale = htmlStr.includes('--map-label-scale') ? 1 : labelScale;
        // const AhtmlStr = htmlStr.replace(/\s*transform:[^;]+;?/gi, '');
        return (
          <Marker
            key={`label-${feature.properties?.name}`}
            longitude={lng}
            latitude={lat}
            anchor="bottom"
          >
            <div
              style={{
                transform: `scale(${visualScale})`,
                transformOrigin: 'bottom center',
                '--map-label-scale': labelScale,
              } as any}
              dangerouslySetInnerHTML={{ __html: htmlStr }}
            />
          </Marker>
        );
      })}
    </>
  );
};

export default LabelRenderer;
