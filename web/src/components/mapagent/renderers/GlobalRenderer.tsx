'use client';

import { CSSProperties, useEffect, useRef } from 'react';

interface GlobalRendererProps {
  globalElements: any[];
  globalProps: any;
  onMeasured?: (rects: Array<{ x: number; y: number; width: number; height: number }>) => void;
}

function getVisualBoundingRect(
  el: Element
): { x: number; y: number; width: number; height: number } | null {
  const self = el.getBoundingClientRect();
  if (self.width > 0 && self.height > 0) {
    return { x: self.left, y: self.top, width: self.width, height: self.height };
  }

  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  let hasAny = false;
  for (const child of el.children) {
    const r = child.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    hasAny = true;
    if (r.left < left) left = r.left;
    if (r.top < top) top = r.top;
    if (r.right > right) right = r.right;
    if (r.bottom > bottom) bottom = r.bottom;
  }
  if (!hasAny) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

const globalContent = (globalProps: any, index: number) => {
  if (Array.isArray(globalProps)) return globalProps[index] || {};
  return globalProps || {};
};

const placementStyle = (element: any, index: number): CSSProperties => {
  const placement = element?.placement || {};
  const isTop = index === 0;
  return {
    position: 'absolute',
    top: placement.top ?? (isTop ? '15%' : undefined),
    bottom: placement.bottom ?? (!isTop ? '10%' : undefined),
    left: placement.left ?? 0,
    width: placement.width ?? '100%',
    display: 'flex',
    justifyContent: 'center',
    pointerEvents: 'none',
    zIndex: 6,
  };
};

const panelStyle = (element: any, index: number): CSSProperties => ({
  maxWidth: index === 0 ? 'min(86%, 760px)' : 'min(82%, 620px)',
  textAlign: 'center',
  pointerEvents: 'none',
  ...((element?.style && typeof element.style === 'object') ? element.style : {}),
});

const GlobalRenderer: React.FC<GlobalRendererProps> = ({ globalElements, globalProps, onMeasured }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !onMeasured) return;

    const timer = setTimeout(() => {
      if (!containerRef.current) return;
      const rects: Array<{ x: number; y: number; width: number; height: number }> = [];
      Array.from(containerRef.current.children).forEach((el) => {
        const r = getVisualBoundingRect(el);
        if (r) rects.push(r);
      });
      onMeasured(rects);
    }, 300);

    return () => clearTimeout(timer);
  }, [globalElements, globalProps, onMeasured]);

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6 }}>
      {globalElements.slice(0, 2).map((element: any, index) => {
        const content = globalContent(globalProps, index);
        const contentType = element.content_type || (index === 0 ? 'title_script_extra' : 'title_script');
        return (
          <div key={element.visual_id || `global-${index}`} style={placementStyle(element, index)}>
            <div style={panelStyle(element, index)}>
              {content.title && (
                <div style={{ fontSize: index === 0 ? 28 : 16, fontWeight: index === 0 ? 800 : 700, lineHeight: 1.15 }}>
                  {content.title}
                </div>
              )}
              {contentType !== 'title' && content.script && (
                <div style={{ marginTop: 6, fontSize: index === 0 ? 14 : 12, lineHeight: 1.35, opacity: 0.82 }}>
                  {content.script}
                </div>
              )}
              {contentType === 'title_script_extra' && content.extra_info && (
                <div style={{ marginTop: 4, fontSize: 11, lineHeight: 1.35, opacity: 0.72 }}>
                  {content.extra_info}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default GlobalRenderer;
