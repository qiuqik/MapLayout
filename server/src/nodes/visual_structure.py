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
  "BaseMap": [{
    "visual_id": "basemap_illustration",
    "type": "blank",
    "description": "手绘插画风格底图，包含渐变色背景（天空蓝到沙漠黄）以及底部的湖泊与胡杨林景观插画"
  }],
  "Point": [
    {
      "visual_id": "point_vis_1",
      "description": "POI的圆形地标图标（内含建筑图案）"
    },
    {
      "visual_id": "point_vis_2",
      "description": "城市图标（标准水滴型地标）"
    }
  ],
  "Area": [
    {
      "visual_id": "area_vis_1",
      "description": "浅蓝色地理区域"
    },
    {
      "visual_id": "area_vis_2",
      "description": "浅黄色地理区域"
    }
  ],
  "Route": [
    {
      "visual_id": "route_vis_1",
      "description": "黑色的主环线，连接乌鲁木齐、库尔勒、阿克苏、塔县等地，形成闭环"
    },
    {
      "visual_id": "route_vis_2",
      "description": "红色的沙漠公路支线，连接阿拉尔与和田"
    }
  ],
  "Label": [
    {
      "visual_id": "label_vis_1",
      "description": "文本标签：乌鲁木齐",
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
      "description": "顶部黑色大字标题：秋季南疆环线攻略，行程主题"
    },
    {
      "visual_id": "global_vis_2",
      "description": "左上角橙色背景条幅：乌进喀出，不走回头路，对行程的简单总结"
    }
  ]
}'''

        safe_visual_example = _escape_prompt_braces(visual_example)
        
        system_prompt = f"""你是一个专业的地图数据可视化架构师。你的任务是分析用户上传的旅游路线参考图，将其拆解为高度抽象的前端渲染组件集。
请不要关注具体的文字内容，而是关注"有什么类型的视觉元素"以及"元素之间的关联"。

## 核心抽象规则（样式去重/合并）：
你输出的每个数组代表的是“视觉样式类（Class）”而非“数据实例”。**只有当视觉样式不一致时，才在数组中分为多个对象。**
- 例如：如果图中有多个高亮区域，但它们的背景色和透明度一致，那么 `Area` 数组只提取一个对象；如果 Area1 是红底，Area2 是蓝底，才包含两个对象。
- 同理，如果所有的悬浮信息卡都是绿底黑字，那么 `Card` 数组只包含一个对象；如果所有路线都是红色虚线，`Route` 数组也只保留一个。
- 此逻辑对所有类别（Area, Card, Label, Point, Route, Edge, Global）均绝对适用。

必须严格使用以下 8 种分类体系，所有分类的输出都必须是数组（即使只有一个元素）：
1. BaseMap: 底图基底（必须包含 type 属性，值为 standard/satellite/blank，并描述背景颜色、渐变或插画风格）
2. Point: 标记具体位置的图形（描述形状、颜色、内部图标图案）
3. Area: 划分“区域/范围/行政区”等**地理区域**的多边形背景色块（描述颜色、透明度、边框等特征）
4. Route: 实际的导航主线或支线（描述颜色和连接逻辑）
5. Label: 依附于其他元素的文本标签
6. Card: 包含详细信息的悬浮卡片背景（描述颜色和内容排版）
7. Edge: 纯视觉牵引线（如从卡片指向地标或区域的连线、箭头）
8. Global: 非地图地理实质元素的全局装饰（如顶部大标题、角落总结条幅等）

**输出要求：**
1. 严格输出 JSON 格式，不要多余的话。
2. 确保每个元素都有唯一且语义化的 `visual_id`（如 basemap_illustration, area_vis_1, point_vis_1）。
3. 使用 `description` 详细描述元素的颜色、形状和视觉特征。
4. 分析依附关系：使用 `anchored_from`（起点）和 `anchored_to`（终点/目标对象，如指向 Point 或 Area）。注意，`anchored_to` 可以是字符串或字符串数组。
5. **如果某类元素在图中没有出现，则省略该数组。**

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
