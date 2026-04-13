'use client';

import { Marker } from 'react-map-gl/mapbox';
import { populateTemplate } from '../utils/mapUtils';

interface LabelRendererProps {
  points: any[];
  labelStyles: any[];
  globalProps: any;
}

const LabelRenderer: React.FC<LabelRendererProps> = ({ points, labelStyles, globalProps }) => {
  return (
    <>
      {points.map((feature: any) => {
        const labelStyle = labelStyles.find(
          (l: any) => l.visual_id === feature.properties?.label_visual_id
        );
        if (!labelStyle) return null;

        const coord = feature.properties?.label_coord || feature.geometry.coordinates;
        const [lng, lat] = coord;
        const htmlStr = populateTemplate(labelStyle.template, feature.properties, globalProps);
        const AhtmlStr = htmlStr.replace(/\s*transform:[^;]+;?/gi, '');
        return (
          <Marker
            key={`label-${feature.properties?.name}`}
            longitude={lng}
            latitude={lat}
            anchor="bottom"
          >
            <div dangerouslySetInnerHTML={{ __html: AhtmlStr }} />
          </Marker>
        );
      })}
    </>
  );
};

export default LabelRenderer;
