'use client';

import { CSSProperties, useEffect, useRef } from 'react';

interface GlobalRendererProps {
  globalElements: any[];
  globalProps: any;
  viewportSize?: { width: number; height: number } | null;
  onMeasured?: (rects: Array<{ x: number; y: number; width: number; height: number }>) => void;
  selectable?: boolean;
  onGlobalSelect?: (element: any, index: number) => void;
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

const placementStyle = (element: any, index: number, viewportSize?: { width: number; height: number } | null): CSSProperties => {
  const isWide = !viewportSize || viewportSize.width >= viewportSize.height;
  const gap = 16;
  const isFirst = index === 0;
  const width = viewportSize?.width || 1100;
  const wideWidth = Math.round(Math.min(isFirst ? 520 : 420, Math.max(isFirst ? 280 : 240, width * (isFirst ? 0.42 : 0.34))));
  const defaultPosition: CSSProperties = isWide
    ? {
        top: isFirst ? gap : undefined,
        bottom: isFirst ? undefined : gap,
        left: isFirst ? gap : undefined,
        right: isFirst ? undefined : gap,
        width: wideWidth,
        justifyContent: isFirst ? 'flex-start' : 'flex-end',
      }
    : {
        top: isFirst ? gap : undefined,
        bottom: isFirst ? undefined : gap,
        left: gap,
        right: gap,
        width: `calc(100% - ${gap * 2}px)`,
        justifyContent: 'center',
      };

  return {
    position: 'absolute',
    ...defaultPosition,
    display: 'flex',
    pointerEvents: 'none',
    zIndex: 6,
  };
};

const styleSection = (style: any, section: string) => (
  style && typeof style === 'object' && style[section] && typeof style[section] === 'object'
    ? style[section]
    : {}
);

const contentTypeFromContent = (content: any, fallback: string) => {
  if (content && typeof content === 'object') {
    if (content.title && content.script && content.extra_info) return 'title_script_extra';
    if (content.title && content.script) return 'title_script';
    if (content.title) return 'title';
  }
  return fallback;
};

const panelStyle = (element: any, index: number, viewportSize?: { width: number; height: number } | null): CSSProperties => {
  const style = element?.style && typeof element.style === 'object' ? element.style : {};
  const containerStyle = style.container && typeof style.container === 'object' ? style.container : style;
  const isWide = !viewportSize || viewportSize.width >= viewportSize.height;
  const defaultSize: CSSProperties = containerStyle.width || containerStyle.height
    ? {}
    : {
        width: '100%',
        minHeight: index === 0 ? 96 : 64,
      };
  return {
    maxWidth: '100%',
    pointerEvents: 'none',
    ...defaultSize,
    ...containerStyle,
    textAlign: isWide ? (index === 0 ? 'left' : 'right') : 'center',
  };
};

const GlobalRenderer: React.FC<GlobalRendererProps> = ({ globalElements, globalProps, viewportSize, onMeasured, selectable = false, onGlobalSelect }) => {
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
  }, [globalElements, globalProps, viewportSize, onMeasured]);

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6 }}>
      {globalElements.slice(0, 2).map((element: any, index) => {
        const content = globalContent(globalProps, index);
        const contentType = contentTypeFromContent(
          element.content,
          element.content_type || (index === 0 ? 'title_script_extra' : 'title_script'),
        );
        const style = element?.style && typeof element.style === 'object' ? element.style : {};
        const titleStyle = styleSection(style, 'title');
        const scriptStyle = styleSection(style, 'script');
        const extraStyle = styleSection(style, 'extra_info');
        return (
          <div
            key={element.visual_id || `global-${index}`}
            data-agent-global-panel={index}
            style={placementStyle(element, index, viewportSize)}
          >
            <div
              style={{
                ...panelStyle(element, index, viewportSize),
                pointerEvents: selectable ? 'auto' : 'none',
                cursor: selectable ? 'pointer' : 'default',
              }}
              onClick={(event) => {
                if (!selectable) return;
                event.stopPropagation();
                onGlobalSelect?.(element, index);
              }}
              onMouseDown={(event) => {
                if (!selectable) return;
                event.stopPropagation();
              }}
            >
              {content.title && (
                <div style={{ fontSize: index === 0 ? 28 : 16, fontWeight: index === 0 ? 800 : 700, lineHeight: 1.15, ...titleStyle }}>
                  {content.title}
                </div>
              )}
              {contentType !== 'title' && content.script && (
                <div style={{ marginTop: 6, fontSize: index === 0 ? 14 : 12, lineHeight: 1.35, opacity: 0.82, ...scriptStyle }}>
                  {content.script}
                </div>
              )}
              {contentType === 'title_script_extra' && content.extra_info && (
                <div style={{ marginTop: 4, fontSize: 11, lineHeight: 1.35, opacity: 0.72, ...extraStyle }}>
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
