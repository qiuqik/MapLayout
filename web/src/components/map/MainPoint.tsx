'use client';

import React from 'react';
import { Marker } from 'react-map-gl/mapbox';

export interface PointsStyle {
  type?: 'default-marker';
  color?: string;
  svg?: string;
}

interface MainPointProps {
  longitude: number;
  latitude: number;
  pointsStyle: PointsStyle;
  index?: number;
}

const DefaultMarker: React.FC<{ color: string }> = ({ color }) => (
  <div
    style={{
      width: 16,
      height: 16,
      borderRadius: '50%',
      backgroundColor: color,
      border: '2px solid white',
      boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
    }}
  />
);

const MainPoint: React.FC<MainPointProps> = ({
  longitude,
  latitude,
  pointsStyle,
  index = 0,
}) => {
  const { type = 'default-marker', color = '#ea580c', svg = '' } = pointsStyle;

  const MarkerIcon =
    type === 'default-marker' ? (
      <DefaultMarker color={color} />
    ) : type === 'div-svg' ? (
      <div dangerouslySetInnerHTML={{ __html: svg }} />
    ) : (
      null
    );

  return (
    <Marker
      key={`main-point-${index}`}
      longitude={longitude}
      latitude={latitude}
      anchor={type === 'default-marker' ? 'center' : 'bottom'}
    >
      <div style={{ width: 24, height: 24 }}>
        {MarkerIcon}
      </div>
    </Marker>
  );
};

export default MainPoint;
