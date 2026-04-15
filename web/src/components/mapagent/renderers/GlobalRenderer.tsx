'use client';

import { useEffect, useRef } from 'react';
import { populateTemplate } from '../utils/mapUtils';

interface GlobalRendererProps {
  globalElements: any[];
  globalProps: any;
  onMeasured?: (rects: Array<{ x: number; y: number; width: number; height: number }>) => void;
}

/**
 * Get the visual bounding rect of a global item element.
 *
 * Strategy (avoids capturing full-screen background overlays):
 * 1. Try getBoundingClientRect() on the element itself.
 *    - This correctly handles CSS transforms (scale/translate/rotate) on the element.
 * 2. If the element has zero layout size (all children are position:absolute so the
 *    parent collapses), look at its IMMEDIATE children only — one level deep.
 *    Taking the union of immediate children avoids diving into deeply nested background
 *    overlays that may span the full viewport.
 *
 * We intentionally do NOT recurse into all descendants, because global HTML often
 * contains background panels (width:100%; height:100%) alongside small content cards.
 * Recursing would capture the background rect and create a full-screen obstacle.
 */
function getVisualBoundingRect(
  el: Element
): { x: number; y: number; width: number; height: number } | null {
  const self = el.getBoundingClientRect();
  if (self.width > 0 && self.height > 0) {
    return { x: self.left, y: self.top, width: self.width, height: self.height };
  }

  // Element has no intrinsic size (abs-positioned children) — union immediate children.
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  let hasAny = false;
  for (const child of el.children) {
    const r = child.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    hasAny = true;
    if (r.left   < left)   left   = r.left;
    if (r.top    < top)    top    = r.top;
    if (r.right  > right)  right  = r.right;
    if (r.bottom > bottom) bottom = r.bottom;
  }
  if (!hasAny) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

const GlobalRenderer: React.FC<GlobalRendererProps> = ({ globalElements, globalProps, onMeasured }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const replaceFontSizeInString = (htmlStr: string, index: number) => {
    const fontSizeRegex = /font-size:\s*\d+px/gi;
    const fontSizeMatches = htmlStr.match(fontSizeRegex) || [];
    const layerCount = fontSizeMatches.length;

    let replaceRules: string[] = [];
    if (index === 0) {
      if (layerCount === 1) {
        replaceRules = ['32px'];
      } else if (layerCount === 2) {
        replaceRules = ['28px', '12px'];
      } else {
        replaceRules = ['32px', '16px', '10px'];
      }
    } else {
      if (layerCount === 1) {
        replaceRules = ['16px'];
      } else {
        replaceRules = ['16px', '10px'];
      }
    }

    let ruleIndex = 0;
    return htmlStr.replace(fontSizeRegex, () => {
      const size = replaceRules[ruleIndex] || replaceRules[replaceRules.length - 1];
      ruleIndex++;
      return `font-size: ${size}`;
    });
  };

  // Measure after the browser has committed the render and applied transforms.
  // 300 ms matches the measurement sandbox delay used for layout inputs.
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
    <div ref={containerRef}>
      {globalElements.map((dec: any, index) => {
        if (dec.iconSvg) {
          return (
            <div
              key={dec.visual_id}
              style={{ pointerEvents: 'none' }}
              dangerouslySetInnerHTML={{ __html: dec.iconSvg }}
            />
          );
        }
        const htmlStr = populateTemplate(dec.template, {}, globalProps);

        return (
          <div
            key={dec.visual_id}
            style={{ pointerEvents: 'none' }}
            dangerouslySetInnerHTML={{ __html: replaceFontSizeInString(htmlStr, index) }}
          />
        );
      })}
    </div>
  );
};

export default GlobalRenderer;
