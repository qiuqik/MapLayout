import os
import base64
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from ..utils.agent_utils import AgentState, _escape_prompt_braces, _extract_first_json_object, _robust_json_loads


class VisualStructureNode:
    """Node 2: 视觉结构解析 (Model: VLM)
    
    输入: 用户提供的参考图
    逻辑: 分析图片，将其拆解为高度抽象的前端渲染组件集，关注"有什么类型的视觉元素"以及"元素之间的关联"
    输出: 结构化的视觉元素字典
    """
    
    def __init__(self, llm: ChatOpenAI):
        self.llm = llm
        
        visual_example = '''{
  "_style_extraction_thought": "观察到图中有 9 个橙色卡片和 9 个红色箭头，虽然卡片文字不同，但样式完全一致，因此合并为 1 个 Card 类和 1 个 Edge 类；观察到没有区域划分，因此不输出 Area 项；观察到路线有黑色实线和红色虚线两种样式，因此拆分为 2 个 Route 类...",
  "BaseMap": [
    {
      "visual_id": "basemap_illustration",
      "type": "blank",
      "description": "手绘风格底图，包含渐变色背景（天空蓝到沙漠黄）"
    }
  ],
  "Point": [
    {
      "visual_id": "point_vis_1",
      "description": "POI的圆形地标图标（内含建筑图案）"
    },
    {
      "visual_id": "point_vis_2",
      "description": "城市图标（标准水滴型地标）"
    },
  ],
  "Area":[
    {
      "visual_id":"area_vis_1",
      "description":"浅蓝色地理区域",
    },
    {
      "visual_id":"area_vis_2",
      "description":"浅黄色地理区域",
    }
  ],
  "Route": [
    {
      "visual_id": "route_vis_1",
      "description": "黑色的主环线形成闭环"
    },
    {
      "visual_id": "route_vis_2",
      "description": "红色的沙漠公路支线"
    }
  ],
  "Label": [
    {
      "visual_id": "label_vis_1",
      "description": "文本标签",
      "anchored_to": ["point_vis_1", "point_vis_2"]
    }
  ],
  "Card": [
    {
      "visual_id": "card_vis_1",
      "description": "绿色背景卡片：包含 POI 名称和简要描述，以及开放时间",
      "anchored_to": "point_vis_1"
    }
  ],
  "Edge": [
    {
      "visual_id": "edge_vis_1",
      "description": "红色箭头，从卡片指向POI位置",
      "anchored_from": "card_vis_1",
      "anchored_to": "point_vis_1"
    }
  ],
  "Global": [
    {
      "visual_id": "global_vis_1",
      "description": "顶部黑色大字标题：行程主题"
    },
    {
      "visual_id": "global_vis_2",
      "description": "左上角橙色背景条幅：对行程的简单总结"
    }
  ]
}'''

        safe_visual_example = _escape_prompt_braces(visual_example)
        
        system_prompt = f"""你是一个专业的地图数据可视化架构师（偏向前端 UI 组件库设计）。你的任务是分析用户上传的旅游路线参考图，提取出高度抽象的前端渲染组件库（UI Classes）。

## 分类体系：
必须严格使用以下 8 种分类体系，所有分类的输出都必须是数组（即使只有一个元素）：
1. BaseMap: 底图基底（必须包含 type 属性，值为 standard/satellite/blank，并描述背景颜色、渐变或插画风格）
2. Point: 标记具体位置的图形（描述形状、颜色、内部图标图案）
3. Area: 划分“区域/范围/行政区”等**地理区域**的多边形背景色块（描述颜色、透明度、边框等特征）
4. Route: 实际的导航主线或支线（描述颜色和连接逻辑）
5. Label: 依附于其他元素的文本标签
6. Card: 包含详细信息的悬浮卡片背景（描述颜色和内容排版）
7. Edge: 纯视觉牵引线（如从卡片指向地标或区域的连线、箭头）
8. Global: 非地图地理实质元素的全局装饰（如顶部大标题、角落总结条幅等）

## 核心输出规则（重要）：
1. **绝对分离“样式”与“内容” (无视具体文字)**：
   - 你只能看到“颜色、形状、粗细、排版”，绝对不要被图上的具体地名、景点名干扰！
   - 错误做法：看到图上有 9 个橙色卡片分别写着不同景点，就输出 9 个 Card 对象。
   - 正确做法：发现它们都是“橙色背景+文字”的排版，**直接合并为 1 个 Card 对象**（统称为“橙色信息卡片”）。

2. **严格的 1:N 样式提取逻辑 (类提取)**：
   - 所有分类数组代表的是“样式大类（Class）”，绝不是“图上的个数（Instance）”。
   - **只有当视觉样式（如背景颜色、形状、边框）真的不一致时，才允许在数组中拆分为多个对象**。比如：图上既有浅蓝色卡片，又有浅绿色卡片，才输出 2 个 Card 对象。
   - **`description` 字段中严禁出现任何具体的地理名称或文本内容！**（只能描述颜色、形状、透明度等 UI 属性）。

**输出要求：**
1. 严格输出 JSON 格式。
2. 确保每个对象都有唯一的 `visual_id`。
4. 分析依附关系：使用 `anchored_from`（起点）和 `anchored_to`（终点）。注意，`anchored_to` 可以是字符串或字符串数组。
5. **如果某类元素在图中没有出现，则省略该数组。**
6. 为了确保你真正做到了“按样式去重”，**你必须在 JSON 的最顶部首先输出一个 `"_style_extraction_thought"` 字段**，简要分析你观察到的各类元素及其数量，以及你是如何把它们按颜色/形状进行合并归类的。

**JSON 模板示例：**
{safe_visual_example}
"""
        
        self.system_prompt = system_prompt
    
    def image_to_base64(self, image_path: str) -> str:
        ext = os.path.splitext(image_path)[1].lower().lstrip('.')
        if ext not in ["jpg", "jpeg", "png", "gif", "bmp"]:
            raise ValueError(f"不支持的图片格式：{ext}")
        
        with open(image_path, "rb") as f:
            base64_data = base64.b64encode(f.read()).decode("utf-8")
        
        return f"data:image/{ext};base64,{base64_data}"
    
    def execute(self, state: AgentState) -> AgentState:
        print("👁️ [Node 2] 视觉结构解析: 正在分析图片中的视觉元素...")
        
        if not state.image_path or not os.path.exists(state.image_path):
            # 如果没有图片，使用默认视觉结构
            state.visual_structure = {
                "BaseMap": [{"visual_id": "basemap_1", "type": "blank", "description": "纯色极简底图"}],
                "Route": [{"visual_id": "route_vis_1", "description": "所有 POI 的连线，表示导航路线"}],
                "Point": [{"visual_id": "point_vis_1", "description": "POI 坐标图标"}],
                "Card": [{"visual_id": "card_vis_1", "description": "POI 详细信息卡片"}],
                "Global": [{"visual_id": "global_vis_1", "description": "地图顶部的大标题"}]
            }
            print("⚠️ [Node 2] 无参考图片，使用默认视觉结构")
            return state
        
        try:
            if not state.image_base64:
                state.image_base64 = self.image_to_base64(state.image_path)

            messages = [
                SystemMessage(content=self.system_prompt),
                HumanMessage(content=[
                    {"type": "image_url", "image_url": {"url": state.image_base64}},
                    {"type": "text", "text": "请分析这张图片的视觉结构，并严格输出 JSON（不要额外解释）。"},
                ]),
            ]
            response = self.llm.invoke(messages)
            content = response.content
            
            json_str = _extract_first_json_object(content)
            if json_str:
                try:
                    import json
                    state.visual_structure = json.loads(json_str)
                except json.JSONDecodeError:
                    state.visual_structure = _robust_json_loads(json_str)
            else:
                # 降级处理
                state.visual_structure = {
                    "BaseMap": [{"visual_id": "basemap_1", "type": "blank", "description": "纯色极简底图"}],
                    "Route": [{"visual_id": "route_vis_1", "description": "所有 POI 的连线，表示导航路线"}],
                    "Point": [{"visual_id": "point_vis_1", "description": "POI 坐标图标"}]
                }
                print("⚠️ [Node 2] 无法解析视觉结构，使用默认结构")
            
            print(f"✅ [Node 2] 视觉结构解析完成")
            print(f"   识别到的元素类型: {list(state.visual_structure.keys())}")
            
        except Exception as e:
            # 降级处理
            state.visual_structure = {
                "BaseMap": [{"visual_id": "basemap_1", "type": "blank", "description": "纯色极简底图"}],
                "Route": [{"visual_id": "route_vis_1", "description": "所有 POI 的连线，表示导航路线"}],
                "Point": [{"visual_id": "point_vis_1", "description": "POI 坐标图标"}]
            }
            state.error = None
            print(f"⚠️ [Node 2] 视觉结构解析失败，已降级为默认结构: {e}")
        
        return state
