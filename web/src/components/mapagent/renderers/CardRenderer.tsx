'use client';

import { Marker } from 'react-map-gl/mapbox';
import { populateTemplate } from '../utils/mapUtils';

interface CardRendererProps {
  points: any[];
  cardStyles: any[];
  globalProps: any;
}

const CardRenderer: React.FC<CardRendererProps> = ({ points, cardStyles, globalProps }) => {
  return (
    <>
      {points.map((feature: any) => {
        const cardStyle = cardStyles.find(
          (c: any) => c.visual_id === feature.properties?.card_visual_id
        );
        if (!cardStyle) return null;

        const coord = feature.properties?.card_coord || feature.geometry.coordinates;
        const [lng, lat] = coord;
        const htmlStr = populateTemplate(cardStyle.template, feature.properties, globalProps);

        return (
          <Marker
            key={`card-${feature.properties?.name}`}
            longitude={lng}
            latitude={lat}
            anchor="bottom"
          >
            <div dangerouslySetInnerHTML={{ __html: htmlStr }} />
          </Marker>
        );
      })}
    </>
  );
};

export default CardRenderer;
