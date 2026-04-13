'use client';

import { Marker } from 'react-map-gl/mapbox';
import { populateTemplate } from '../utils/mapUtils';

interface CardRendererProps {
  points: any[];
  polygons: any[];
  cardStyles: any[];
  globalProps: any;
}

const CardRenderer: React.FC<CardRendererProps> = ({ points, polygons, cardStyles, globalProps }) => {
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
        const AhtmlStr = htmlStr.replace(/\s*transform:[^;]+;?/gi, '');

        return (
          <Marker
            key={`card-point-${feature.properties?.name}`}
            longitude={lng}
            latitude={lat}
            anchor="bottom"
          >
            <div dangerouslySetInnerHTML={{ __html: AhtmlStr }} />
          </Marker>
        );
      })}
      {polygons.map((feature: any) => {
        const cardStyle = cardStyles.find(
          (c: any) => c.visual_id === feature.properties?.card_visual_id
        );
        if (!cardStyle) return null;

        const coord = feature.properties?.card_coord || feature.geometry.coordinates[0][0];
        const [lng, lat] = coord;
        const htmlStr = populateTemplate(cardStyle.template, feature.properties, globalProps);
        const AhtmlStr = htmlStr.replace(/\s*transform:[^;]+;?/gi, '');

        return (
          <Marker
            key={`card-polygon-${feature.properties?.name}`}
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

export default CardRenderer;
