'use client';

import React from 'react';

interface BaseMapRendererProps {
  baseMapStyle: any;
}

const BaseMapRenderer: React.FC<BaseMapRendererProps> = ({ baseMapStyle }) => {
  const overlayColor = baseMapStyle?.tintColor || baseMapStyle?.overlayColor;
  const overlayOpacity = Number(baseMapStyle?.tintOpacity ?? baseMapStyle?.overlayOpacity ?? 0);

  if (baseMapStyle?.type !== 'blank' && overlayColor && overlayOpacity > 0) {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 2,
          pointerEvents: 'none',
          background: overlayColor,
          opacity: Math.min(0.35, Math.max(0, overlayOpacity)),
          mixBlendMode: baseMapStyle?.mixBlendMode || 'multiply',
        }}
      />
    );
  }

  if (baseMapStyle?.type !== 'blank' || !baseMapStyle.iconSvg) {
    return null;
  }

  return (
    <div 
      style={{ 
        position: 'absolute', 
        top: 0, 
        left: 0, 
        width: '100%', 
        height: '100%', 
        zIndex: 0 
      }}
      dangerouslySetInnerHTML={{ __html: baseMapStyle.iconSvg }}
    />
  );
};

export default BaseMapRenderer;
