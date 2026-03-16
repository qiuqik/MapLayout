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
      "iconSvg": "<svg></svg>"
    },
    {
      "visual_id": "point_vis_2",
      "iconSvg": "<svg></svg>"
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
        
        system_prompt = f"""你是一个资深的地图 UI 视觉还原工程师与前端组件专家。你将接收：
1.[旅游路线参考图]
2. [视觉元素拆解 visual.json]
3.[用户实际行程 geojson]

你的任务是：对 visual.json 进行重构输出，为前端提供直接可用的样式与渲染模板。

## 核心重构规则：
1. **精准过滤 (白名单机制)**：你必须仔细检查 geojson，**仅输出 geojson 中实际出现的 visual_id**。不能输出 geojson 中未引用的任何 Area, Card, Edge 或 Point 样式！
2. **BaseMap 底图 (极简抽象原则)**：type 可取值为 "blank"/"satellite"/"standard"。如果 type 为 "blank"，必须输出 `iconSvg` 字段。
    - 对于`iconSvg` 字段，**禁用 viewBox**，只需用极简的 SVG 代码填充纯色或简单的 `<linearGradient>` 渐变即可。（❌错误示范：`width="100"`，✅正确示范：`width="100%"`）
3. **Point 标记**：必须输出精美的内联 SVG 代码到 `iconSvg` 字段（如城市水滴坐标、单色圆点、建筑图案等）。
4. **Area 区域**：根据视觉描述，输出多边形的样式配置，通常包含 `backgroundColor` (十六进制), `borderColor`, `borderWidth`, 以及 `opacity` (透明度数值)。
5. **Route 路线**：只需输出 `color` (HEX格式)、`width` (数字) 以及 `style` 字段。请根据参考图判断并输出 `style` 值为 `"navigationCurve"`（曲线） 或 `"straightLine"`（直线）。
6. **Edge 连线**：输出 `anchored_from`, `anchored_to`, `color`, 以及 `type` (如 `"straight"`, `"dashed"`)。
7. **模板渲染 (Label, Card, Global)**：
   - 必须输出 `template` 字段，包含纯正的内联 HTML/CSS 代码。
   - 样式需贴合参考图（颜色、圆角、阴影、字体大小等）。
   - 变量注入：使用 `{{properties.字段名}}` 占位；如果是 Global 元素，请使用 `{{global_properties[0].字段名}}`（注意数组索引）。
   - Global 元素必须自带绝对定位 CSS（如 `position: absolute; top: 20px; z-index: 100;`）。

## 输出格式要求：
严格输出 JSON 格式。
**为了保证过滤准确，你必须在 JSON 最顶部优先输出 `"_used_visual_ids"` 数组字段**，列出你在 geojson 中找到的所有 visual_id，随后的所有分类输出，**必须严格限制在这个白名单内**。"""
        
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
