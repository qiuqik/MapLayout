import os
import base64
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from ..utils.agent_utils import AgentState, _escape_prompt_braces, _extract_first_json_object, _robust_json_loads
from ..utils.prompt_loader import load_prompt
from ..validators.schema_validators import validate_visual_structure


class VisualStructureNode:
    """Node 2: 视觉结构解析 (Model: VLM)
    
    输入: 用户提供的参考图
    逻辑: 分析图片，将其拆解为高度抽象的前端渲染组件集，关注"有什么类型的视觉元素"以及"元素之间的关联"
    输出: 结构化的视觉元素字典
    """

    PROMPT_NAME = "visual_structure"
    PROMPT_VERSION = "v0.1"
    
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
        system_prompt = load_prompt("visual_structure.md").format(
            visual_example=safe_visual_example
        )
        
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

        schema_report = validate_visual_structure(state.visual_structure)
        if schema_report["valid"]:
            if schema_report["warnings"]:
                print(f"⚠️ [Node 2] Visual schema warnings: {schema_report['warnings']}")
            else:
                print("✅ [Node 2] Visual schema 校验通过")
        else:
            print(f"⚠️ [Node 2] Visual schema 校验失败: {schema_report['errors']}")
        
        return state
