'use client';

import React from 'react';

interface BaseMapRendererProps {
  baseMapStyle: any;
}

const BaseMapRenderer: React.FC<BaseMapRendererProps> = ({ baseMapStyle }) => {
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
