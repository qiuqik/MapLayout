from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from ..utils.agent_utils import AgentState, _escape_prompt_braces, _extract_first_json_object, _robust_json_loads


class StyleCodeGenerationNode:
    """Node 4: 样式推演与模板引擎 (Model: VLM/GPT-5)
    
    输入: 参考图片 + 视觉结构 + GeoJSON 数据
    逻辑: 观察原图提取视觉样式（Design Tokens），结合 GeoJSON 中的数据实例，输出结构化的前端渲染样式代码
    输出: 结构化的前端渲染样式代码
    """
    
    def __init__(self, llm: ChatOpenAI):
        self.llm = llm
        
        style_example = '''{
  "BaseMap": [
    {
      "type": "blank",
      "iconSvg": "<svg width=\"100%\" height=\"100%\" xmlns=\"http://www.w3.org/2000/svg\"><defs><linearGradient id=\"skyToDesert\" x1=\"0%\" y1=\"0%\" x2=\"100%\" y2=\"100%\"><stop offset=\"0%\" style=\"stop-color:#87CEEB;stop-opacity:1\" /><stop offset=\"100%\" style=\"stop-color:#EDC9AF;stop-opacity:1\" /></linearGradient></defs><rect width=\"100%\" height=\"100%\" fill=\"url(#skyToDesert)\" /></svg>"
    }
  ],
  "Point": [
    {
      "visual_id": "point_vis_1",
      "iconSvg": "<svg width='24' height='24' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'><path d='M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z' fill='#d32f2f'/></svg>"
    },
    {
      "visual_id": "point_vis_2",
      "iconSvg": "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z' fill='#fbbf24' stroke='#b45309' stroke-width='1.5'/><circle cx='12' cy='9' r='3.5' fill='white'/><path d='M12 6l-3 3v3h6V9l-3-3z' fill='#1e40af'/></svg>"
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
      "template": "<div style='background:#FFE0B2; border:1px solid #FFB74D; border-radius:8px; padding:10px; width:200px; box-shadow:0 4px 6px rgba(0,0,0,0.1);'><h3 style='margin:0 0 4px 0; font-size:14px; font-weight:bold; color:#E65100;'>{{properties.name}}</h3><p style='margin:0; font-size:12px; color:#555; line-height:1.4;'>{{properties.description}}</p><p style='margin:0; font-size:12px; color:#555; line-height:1.4;'>{{properties.open_time}}</p></div>"
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
      "template": "<div style='position: absolute; top: 20px; left: 20px; z-index: 100; font-size: 18px; font-weight: bold; color: #333; line-height: 1.4;'><h3>{global_properties[0].title}</h3><p style='font-size: 12px; color: #666;'>{global_properties[0].description}</p></div>"
    },
    {
      "visual_id": "global_vis_2",
      "template": "<div style='position: absolute; top: 20px; left: 20px; z-index: 100; font-size: 18px; font-weight: bold; color: #333; line-height: 1.4;'><h3>{global_properties[0].title}</h3><p style='font-size: 12px; color: #666;'>{global_properties[1].description}</p></div>"
    }
  ]
}'''

        safe_style_example = _escape_prompt_braces(style_example)
        
        system_prompt = f"""你是一个资深的地图 UI 视觉还原工程师与前端组件专家。你将接收：
1.[旅游路线参考图]
2. [视觉元素拆解 visual.json]
3.[用户实际行程 geojson]

你的任务是：对 visual.json 进行重构输出，为前端提供直接可用的样式与渲染模板。

## 核心重构规则：
1. **按类去重与精准过滤**：输出数组中的对象代表“视觉大类”。
    - 对于所有情况（Area, Card, Point 等），只有样式不同才会有多个对象。例如：如果 geojson 中所有卡片都引用了同一个 card_visual_id，那么 `Card` 数组中只输出一个通用的模板对象即可；如果两个区域的颜色不同，`Area` 数组才分别输出这两个不同 visual_id 的配置。
    - **仅输出 geojson 中被实际引用的 visual_id 项**。
2. **精准过滤**：对于 visual.json 中没有提及的项无需输出；且只输出 geojson 中被实际引用（存在）的 visual_id 项。
3. **BaseMap 底图**：type 可取值为 "blank"/"satellite"/"standard"。如果 type 为 "blank"，**必须输出 `iconSvg` 字段**
    - **严禁生成复杂的插画、风景、树木、建筑或纹理！** 大量复杂的 `<path>` 会导致代码冗长且极度难看。
    - 请只提取原图最核心的“整体背景色”或“大面积渐变色（如天空到沙漠的过渡）”。
    - 只需用极简的 SVG 代码输出一个铺满全屏的 `<rect>`，并填充纯色或简单的 `<linearGradient>` 渐变即可。
4. **Point 标记**：**必须输出 `iconSvg` 字段**。请根据 visual.json 的描述，编写精美的内联 SVG 代码（如城市水滴坐标、单色圆点、建筑图案等），确保支持透明背景与正确的 viewBox。
5. **Area 区域**：根据视觉描述，输出多边形的样式配置，通常包含 `backgroundColor` (十六进制), `borderColor`, `borderWidth`, 以及 `opacity` (透明度数值)。
6. **Route 路线**：只需输出 `color` (HEX格式)、`width` (数字) 以及 `style` 字段。请根据参考图判断并输出 `style` 值为 `"navigationCurve"`（曲线） 或 `"straightLine"`（直线）。
7. **Edge 连线**：输出 `anchored_from`, `anchored_to`, `color`, 以及 `type` (如 `"straight"`, `"dashed"`)。
8. **模板渲染 (Label, Card, Global)**：
   - 必须输出 `template` 字段，包含纯正的内联 HTML/CSS 代码。
   - 样式需贴合原图描述（颜色、圆角、阴影、字体大小等）。
   - 变量注入：使用 `{{properties.字段名}}` 占位；如果是 Global 元素，请使用 `{{global_properties[0].字段名}}`（注意数组索引）。
   - Global 元素必须自带绝对定位 CSS（如 `position: absolute; top: 20px; z-index: 100;`）。


## 输出格式要求：
严格输出 JSON 格式。最外层 Key 严格遵循视觉大类（BaseMap, Area, Point, Route, Label, Card, Edge, Global），内部为对象数组。
（请仔细检查你的 SVG 语法和 HTML 内联样式的闭合规范）"""
        
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
        
        return state
