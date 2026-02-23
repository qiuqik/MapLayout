'use client';

import React from 'react';
import { Marker } from 'react-map-gl/mapbox';

export interface PointsStyle {
  type?: 'default' | 'svg';
  color?: string;
  iconSvg?: string;
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
  const { type = 'default', color = '#ea580c', iconSvg = '' } = pointsStyle;

  const MarkerIcon =
    type === 'default' ? (
      <DefaultMarker color={color} />
    ) : type === 'svg' ? (
      <div dangerouslySetInnerHTML={{ __html: iconSvg }} />
    ) : (
      null
    );

  return (
    <Marker
      key={`main-point-${index}`}
      longitude={longitude}
      latitude={latitude}
      anchor={type === 'default' ? 'center' : 'bottom'}
    >
      <div style={{ width: 24, height: 24 }}>
        {MarkerIcon}
      </div>
    </Marker>
  );
};

export default MainPoint;
