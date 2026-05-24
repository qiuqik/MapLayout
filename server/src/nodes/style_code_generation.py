from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from ..utils.agent_utils import AgentState, _escape_prompt_braces, _extract_first_json_object, _robust_json_loads
from ..utils.prompt_loader import load_prompt
from ..validators.schema_validators import validate_style_spec
import re


def clean_transform_from_html(style_code: dict) -> dict:
    """
    清洗 stylejson 中 Card 和 Label 的 template HTML 中的 transform、width、height 样式
    保留 Global 元素中的这些样式（因为 Global 需要绝对定位）
    """
    if not isinstance(style_code, dict):
        return style_code
    
    elements_to_clean = ['Card', 'Label']
    
    for element_type in elements_to_clean:
        if element_type not in style_code:
            continue
        
        for item in style_code[element_type]:
            if 'template' not in item:
                continue
            
            template = item['template']
            
            # 移除 transform 样式（包括 transform 和 -webkit-transform 等前缀）
            template = re.sub(
                r'\s*(?:-webkit-|-moz-|-ms-|-o-)?transform\s*:\s*[^;]+;?',
                '',
                template
            )
            
            # 移除 width 样式
            template = re.sub(
                r'\s*width\s*:\s*[^;]+;?',
                '',
                template
            )
            
            # 移除 height 样式
            template = re.sub(
                r'\s*height\s*:\s*[^;]+;?',
                '',
                template
            )
            
            item['template'] = template
    
    return style_code


class StyleCodeGenerationNode:
    """Node 4: 样式推演与模板引擎 (Model: VLM/GPT-5)
    
    输入: 参考图片 + 视觉结构 + GeoJSON 数据
    逻辑: 观察原图提取视觉样式（Design Tokens），结合 GeoJSON 中的数据实例，输出结构化的前端渲染样式代码
    输出: 结构化的前端渲染样式代码
    """

    PROMPT_NAME = "style_code_generation"
    PROMPT_VERSION = "v0.1"
    
    def __init__(self, llm: ChatOpenAI):
        self.llm = llm
        
        style_example = '''{
  "_used_visual_ids": ["basemap_illustration", "point_vis_1", "point_vis_2", "area_vis_1", "area_vis_2", "route_vis_1", "label_vis_1", "card_vis_1", "edge_vis_1", "global_vis_1", "global_vis_2"],
  "BaseMap": [
    {
      "type": "blank",
      "iconSvg": "<svg width=\"100%\" height=\"100%\" xmlns=\"http://www.w3.org/2000/svg\"><defs><linearGradient id=\"skyToDesert\" x1=\"0%\" y1=\"0%\" x2=\"100%\" y2=\"100%\"><stop offset=\"0%\" style=\"stop-color:#87CEEB;stop-opacity:1\" /><stop offset=\"100%\" style=\"stop-color:#EDC9AF;stop-opacity:1\" /></linearGradient></defs><rect width=\"100%\" height=\"100%\" fill=\"url(#skyToDesert)\" /></svg>"
    }
  ],
  "Point": [
    {
      "visual_id": "point_vis_1",
      "iconSvg": "<svg viewBox='0 0 100 100' style='width:12px; height:12px; display:block;'><circle cx='50%' cy='50%' r='40%' fill='#FFC107' stroke='#F57C00' stroke-width='15%'/></svg>"
    },
    {
      "visual_id": "point_vis_2",
      "iconSvg": "<svg viewBox='0 0 100 100' style='width:12px; height:12px; display:block;'><circle cx='50%' cy='50%' r='40%' fill='#FFC107' stroke='#F57C00' stroke-width='15%'/></svg>"
    }
  ],
  "Area":[
    {
      "visual_id":"area_vis_1",
      "backgroundColor":"#729384",
      "borderColor":"#122321",
      "borderWidth": 3,
      "opacity": 0.5
    },
    {
      "visual_id":"area_vis_2",
      "backgroundColor":"#344584",
      "borderColor":"#112542",
      "borderWidth": 3,
      "opacity": 0.5
    }
  ],
  "Route": [
    {
      "visual_id": "route_vis_1",
      "color": "#000000",
      "width": 4,    
      "style": "navigationCurve"
    }
  ],
  "Label": [
    {
      "visual_id": "label_vis_1",
      "template": "<div style='background-color: #FFF; padding: 6px 10px; border-radius: 4px; font-size: 12px; color: #000; box-shadow: 0 1px 3px rgba(0,0,0,0.2);'>{properties.name}</div>"
    }
  ],
  "Card": [
    {
      "visual_id": "card_vis_1",
      "template": "<div style='xx'><h3>{{properties.name}}</h3><p >{{properties.description}}</p><p>{{properties.open_time}}</p></div>"
    }
  ],
  "Edge": [
    {
      "visual_id": "edge_vis_1",
      "anchored_from": "card_vis_1",
      "anchored_to": "point_vis_1",
      "color": "#d32f2f",
      "type": "straight",
    }
  ],
  "Global": [
    {
      "visual_id": "global_vis_1",
      "template": "<div style='xx'><h3>{global_properties[0].title}</h3><p>{global_properties[0].description}</p></div>"
    },
    {
      "visual_id": "global_vis_2",
      "template": "<div style='xx'><h3>{global_properties[0].title}</h3><p style='xx'>{global_properties[0].description}</p></div>"
    }
  ]
}'''

        safe_style_example = _escape_prompt_braces(style_example)
        system_prompt = load_prompt("style_code_generation.md")
        
        self.system_prompt = system_prompt
    
    def execute(self, state: AgentState) -> AgentState:
        print("🎨 [Node 4] 样式推演与模板引擎: 正在生成前端渲染样式代码...")
        
        if not state.visual_structure:
            state.error = "缺少视觉结构解析结果"
            print(f"❌ [Node 4] 缺少视觉结构")
            return state
        
        if not state.geojson_data:
            state.error = "缺少 GeoJSON 数据"
            print(f"❌ [Node 4] 缺少 GeoJSON 数据")
            return state
        
        try:
            import json
            messages = [
                SystemMessage(content=self.system_prompt),
                HumanMessage(content=[
                    {"type": "text", "text": f"视觉元素拆解：\n{json.dumps(state.visual_structure, ensure_ascii=False)}"},
                    {"type": "text", "text": f"GeoJSON 数据：\n{json.dumps(state.geojson_data, ensure_ascii=False)}"},
                    {"type": "text", "text": "请生成前端渲染样式代码（严格输出 JSON）："}
                ]),
            ]
            
            # 如果有图片，添加图片到消息中
            if state.image_base64:
                messages[1].content.insert(0, {
                    "type": "image_url", 
                    "image_url": {"url": state.image_base64}
                })
            
            response = self.llm.invoke(messages)
            content = response.content
            
            json_str = _extract_first_json_object(content)
            if json_str:
                try:
                    style_code = json.loads(json_str)
                except json.JSONDecodeError:
                    style_code = _robust_json_loads(json_str)
                
                state.style_code = style_code
                # 清洗 Card 和 Label 中的 transform 样式
                state.style_code = clean_transform_from_html(state.style_code)
                print(f"✅ [Node 4] Style Code 生成完成")
                print(f"   生成的样式类别: {list(style_code.keys())}")
            else:
                raise ValueError("无法解析 Style Code JSON")
                
        except Exception as e:
            # 降级处理
            state.style_code = {
                "BaseMap": [
                    {
                        "type": "blank",
                        "iconSvg": "<svg width=\"100%\" height=\"100%\" xmlns=\"http://www.w3.org/2000/svg\"><rect width=\"100%\" height=\"100%\" fill=\"#F4F6F9\" /></svg>"
                    }
                ],
                "Point": [
                    {
                        "visual_id": "point_vis_1",
                        "iconSvg": "<svg width='24' height='24' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'><path d='M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z' fill='#FF5722'/></svg>"
                    }
                ],
                "Route": [
                    {
                        "visual_id": "route_vis_1",
                        "color": "#FF5722",
                        "width": 4,
                        "style": "navigationCurve"
                    }
                ],
                "Card": [
                    {
                        "visual_id": "card_vis_1",
                        "template": "<div style='background:#FFF; border:1px solid #E0E0E0; border-radius:8px; padding:10px; width:200px; box-shadow:0 4px 6px rgba(0,0,0,0.1);'><h3 style='margin:0 0 4px 0; font-size:14px; font-weight:bold; color:#333;'>{properties.name}</h3><p style='margin:0; font-size:12px; color:#666; line-height:1.4;'>{properties.description}</p><p style='margin:0; font-size:12px; color:#666; line-height:1.4;'>{properties.open_time}</p></div>"
                    }
                ],
                "Global": [
                    {
                        "visual_id": "global_vis_1",
                        "template": "<div style='position: absolute; top: 20px; left: 20px; z-index: 100; font-size: 18px; font-weight: bold; color: #333; line-height: 1.4;'><h3>{global_properties[0].title}</h3><p style='font-size: 12px; color: #666;'>{global_properties[0].description}</p></div>"
                    }
                ]
            }
            state.error = f"Style Code 生成失败: {str(e)}"
            print(f"⚠️ [Node 4] Style Code 生成失败，已降级为默认样式: {e}")

        schema_report = validate_style_spec(state.style_code)
        if schema_report["valid"]:
            print("✅ [Node 4] Style schema 校验通过")
        else:
            print(f"⚠️ [Node 4] Style schema 校验失败: {schema_report['errors']}")
        
        return state
