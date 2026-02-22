'use client';

import React, { useMemo } from 'react';
import type { MapRef } from 'react-map-gl/mapbox';
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
  cardWidth?: number;
  cardHeight?: number;
  mapRef?: React.RefObject<MapRef | null>;
  mapLoaded?: boolean;
  viewState?: { longitude?: number; latitude?: number; zoom?: number };
  index?: number;
}

const CARD_WIDTH_DEFAULT = 256;
const CARD_HEIGHT_DEFAULT = 180;

// 计算线段与矩形的交点
function lineRectIntersection(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  left: number,
  top: number,
  right: number,
  bottom: number
): { x: number; y: number; t: number } | null {
  const dx = bx - ax;
  const dy = by - ay;
  let best: { x: number; y: number; t: number } | null = null;

  const consider = (t: number) => {
    if (t > 1e-6 && t <= 1 && (!best || t < best.t)) {
      const x = ax + t * dx;
      const y = ay + t * dy;
      if (left <= x && x <= right && top <= y && y <= bottom) {
        best = { x, y, t };
      }
    }
  };

  if (Math.abs(dy) > 1e-10) {
    consider((bottom - ay) / dy);
    consider((top - ay) / dy);
  }
  if (Math.abs(dx) > 1e-10) {
    consider((right - ax) / dx);
    consider((left - ax) / dx);
  }
  return best;
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
  cardWidth = CARD_WIDTH_DEFAULT,
  cardHeight = CARD_HEIGHT_DEFAULT,
  mapRef,
  mapLoaded,
  viewState,
  index = 0,
}) => {
  const { color = '#7f3249', type = 'straight', arrow = 'none' } = connectLineStyle;

  // 计算卡片与点的交点
  const cardEndCoord = useMemo((): [number, number] => {
    if (!mapLoaded || !mapRef?.current) return cardCoord;
    const map = mapRef.current;
    const anchorPt = map.project([cardCoord[0], cardCoord[1]]);
    const pointPt = map.project([pointCoord[0], pointCoord[1]]);
    const left = anchorPt.x - 5;
    const bottom = anchorPt.y + 5;
    const right = anchorPt.x + cardWidth + 5;
    const top = anchorPt.y - cardHeight - 5;
    const centerX = left + cardWidth / 2;
    const centerY = bottom - cardHeight / 2;
    const hit = lineRectIntersection(
      pointPt.x,
      pointPt.y,
      centerX,
      centerY,
      left,
      top,
      right,
      bottom
    );
    if (hit) {
      const lngLat = map.unproject([hit.x, hit.y]);
      return [lngLat.lng, lngLat.lat];
    }
    return cardCoord;
  }, [
    pointCoord,
    cardCoord,
    cardWidth,
    cardHeight,
    mapLoaded,
    mapRef?.current,
    viewState?.longitude,
    viewState?.latitude,
    viewState?.zoom,
  ]);

  const geojson = useMemo(() => {
    const coords = lineCoord(pointCoord, cardEndCoord, type);
    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'LineString' as const,
            coordinates: coords,
          },
        },
      ],
    };
  }, [pointCoord, cardEndCoord, type]);

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

  const arrowEndCoord = arrow === 'Point2Card' ? cardEndCoord : arrow === 'Card2Point' ? pointCoord : null;

  const arrowRotation = useMemo(() => {
    if (!arrowEndCoord || !arrow) return 0;
    const [from, to] =
      arrow === 'Point2Card'
        ? [pointCoord, cardEndCoord]
        : arrow === 'Card2Point'
          ? [cardEndCoord, pointCoord]
          : null;
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const angleRad = Math.atan2(dx, dy);
    return (angleRad * 180) / Math.PI;
  }, [arrowEndCoord, arrow, pointCoord, cardEndCoord]);

  return (
    <div>
      <Source id={`connect-line-source-${index}`} type="geojson" data={geojson}>
        <Layer {...lineLayerStyle} />
      </Source>
      {arrowEndCoord && (
        <Marker 
          longitude={arrowEndCoord[0]} 
          latitude={arrowEndCoord[1]} 
          anchor="center"
        >
          <div
            style={{
              width: 0,
              height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderBottom: `12px solid ${color}`,
              transform: `rotate(${arrowRotation}deg)`
            }}
          />
        </Marker>
      )}
    </div>
  );
};

export default ConnectLine;
