'use client';

import React, { useMemo } from 'react';
import { Source, Layer, LayerProps, Marker } from 'react-map-gl/mapbox';

export interface ConnectLineStyle {
  color?: string;
  type?: 'straight' | 'SmoothCurve';
  arrow?: 'none' | 'Point2Card' | 'Card2Point';
}

interface ConnectLineProps {
  pointCoord: [number, number];
  cardCoord: [number, number];
  connectLineStyle: ConnectLineStyle;
  index?: number;
}

function lineCoord(
  point: [number, number],
  card: [number, number],
  lineType: ConnectLineStyle['type']
): GeoJSON.Position[] {
  if (lineType === 'SmoothCurve') {
    const mid: [number, number] = [
      (point[0] + card[0]) / 2 + (card[1] - point[1]) * 0.02,
      (point[1] + card[1]) / 2 + (point[0] - card[0]) * 0.02,
    ];
    return [point, mid, card];
  }
  return [point, card];
}

const ConnectLine: React.FC<ConnectLineProps> = ({
  pointCoord,
  cardCoord,
  connectLineStyle,
  index = 0,
}) => {
  const { color = '#7f3249', type = 'straight', arrow = 'none' } = connectLineStyle;

  const geojson = useMemo(() => {
    const coords = lineCoord(pointCoord, cardCoord, type);
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: coords,
      },
    };
  }, [pointCoord, cardCoord, type]);

  const lineLayerStyle: LayerProps = {
    id: `connect-line-${index}`,
    type: 'line',
    layout: {
      'line-join': type === 'SmoothCurve' ? 'round' : 'miter',
      'line-cap': 'round',
    },
    paint: {
      'line-color': color,
      'line-width': 2,
    },
  };

  const arrowEndCoord = arrow === 'Point2Card' ? cardCoord : arrow === 'Card2Point' ? pointCoord : null;

  const arrowRotation = useMemo(() => {
    if (!arrowEndCoord || !arrow) return 0;
    const [from, to] =
      arrow === 'Point2Card' ? [pointCoord, cardCoord] : arrow === 'Card2Point' ? [cardCoord, pointCoord] : null;
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const angleRad = Math.atan2(dx, dy);
    return (angleRad * 180) / Math.PI;
  }, [arrowEndCoord, arrow, type, pointCoord, cardCoord]);

  return (
    <>
      <Source id={`connect-line-source-${index}`} type="geojson" data={geojson}>
        <Layer {...lineLayerStyle} />
      </Source>
      {arrowEndCoord && (
        <Marker longitude={arrowEndCoord[0]} latitude={arrowEndCoord[1]} anchor="center">
          <div
            style={{
              width: 0,
              height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderBottom: `10px solid ${color}`,
              transform: `rotate(${arrowRotation}deg)`,
            }}
          />
        </Marker>
      )}
    </>
  );
};

export default ConnectLine;
