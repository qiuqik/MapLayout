'use client';

import { populateTemplate } from '../utils/mapUtils';

interface GlobalRendererProps {
  globalElements: any[];
  globalProps: any;
}

const GlobalRenderer: React.FC<GlobalRendererProps> = ({ globalElements, globalProps }) => {
  return (
    <>
      {globalElements.map((dec: any) => {
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
            dangerouslySetInnerHTML={{ __html: htmlStr }}
          />
        );
      })}
    </>
  );
};

export default GlobalRenderer;
