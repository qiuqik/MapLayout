'use client';

import { populateTemplate } from '../utils/mapUtils';

interface GlobalRendererProps {
  globalElements: any[];
  globalProps: any;
}

const GlobalRenderer: React.FC<GlobalRendererProps> = ({ globalElements, globalProps }) => {
  const replaceFontSizeInString = (htmlStr, index) => {
  // 匹配所有 style 里的 font-size: 数字px
  const fontSizeRegex = /font-size:\s*\d+px/gi;
  
  const fontSizeMatches = htmlStr.match(fontSizeRegex) || [];
  const layerCount = fontSizeMatches.length;

  let replaceRules = [];
  
  if (index === 0) {
    // 第一个元素
    if (layerCount === 1) {
      replaceRules = ['32px'];
    } else if (layerCount === 2) {
      replaceRules = ['28px', '12px'];
    } else {
      replaceRules = ['32px', '16px', '10px'];
    }
  } else {
    // 第二个及以后
    if (layerCount === 1) {
      replaceRules = ['16px'];
    } else {
      replaceRules = ['16px', '10px'];
    }
  }

  let ruleIndex = 0;
  const result = htmlStr.replace(fontSizeRegex, (match) => {
    const size = replaceRules[ruleIndex] || replaceRules[replaceRules.length - 1];
    ruleIndex++;
    return `font-size: ${size}`;
  });

  return result;
}
  return (
    <>
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
    </>
  );
};

export default GlobalRenderer;
