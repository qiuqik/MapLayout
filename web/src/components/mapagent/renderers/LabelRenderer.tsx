'use client';

import { Marker } from 'react-map-gl/mapbox';
import {
  buildLabelHtml,
  normalizeLabelHierarchy,
  selectLabelStyleForFeature,
} from '../utils/mapUtils';

interface LabelRendererProps {
  points: any[];
  labelStyles: any[];
  globalProps: any;
  labelScale?: number;
  hideDetailLabels?: boolean;
  selectable?: boolean;
  onFeatureSelect?: (feature: any, kind: 'label') => void;
}

const LabelRenderer: React.FC<LabelRendererProps> = ({ points, labelStyles, labelScale = 1, hideDetailLabels = false, selectable = false, onFeatureSelect }) => {
  return (
    <>
      {points.map((feature: any) => {
        const labelStyle = selectLabelStyleForFeature(feature, labelStyles);
        if (!labelStyle) return null;
        const hierarchy = normalizeLabelHierarchy(feature.properties?.label_level ?? labelStyle.hierarchy);
        if (hideDetailLabels && hierarchy === 'detail') return null;

        const coord = feature.properties?.label_coord || feature.geometry.coordinates;
        const [lng, lat] = coord;
        const htmlStr = buildLabelHtml(feature, labelStyle);
        return (
          <Marker
            key={`label-${feature.properties?.feature_id || feature.properties?.name}`}
            longitude={lng}
            latitude={lat}
            anchor="bottom"
          >
            <div
              className="map-feature-click-target"
              data-map-feature-kind="label"
              onClick={(event) => {
                if (!selectable) return;
                event.stopPropagation();
                onFeatureSelect?.(feature, 'label');
              }}
              onMouseDown={(event) => {
                if (!selectable) return;
                event.stopPropagation();
              }}
              style={{
                '--map-label-scale': labelScale,
                pointerEvents: selectable ? 'auto' : 'none',
                cursor: selectable ? 'pointer' : 'default',
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
