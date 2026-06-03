import os
import base64
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from ..utils.agent_utils import AgentState, _extract_first_json_object, _robust_json_loads
from ..utils.prompt_loader import load_prompt
from ..validators.schema_validators import validate_visual_structure


class VisualStructureNode:
    """Node 2: 视觉结构解析 (Model: VLM)
    
    输入: 用户提供的参考图
    逻辑: 分析图片，将其拆解为高度抽象的前端渲染组件集，关注"有什么类型的视觉元素"以及"元素之间的关联"
    输出: 结构化的视觉元素字典
    """

    PROMPT_NAME = "visual_structure"
    PROMPT_VERSION = "v0.4"
    
    def __init__(self, llm: ChatOpenAI):
        self.llm = llm
        
        visual_example = '''{
  "Color": {
    "palette": [
      {"name": "warm paper", "hex": "#F7F3EA", "usage": "background", "weight": 0.42},
      {"name": "ink black", "hex": "#2A2520", "usage": "primary text", "weight": 0.18},
      {"name": "river blue", "hex": "#A8C7D8", "usage": "water", "weight": 0.12},
      {"name": "route red", "hex": "#D84A3A", "usage": "accent route", "weight": 0.1},
      {"name": "park green", "hex": "#CFE3B4", "usage": "parks", "weight": 0.1},
      {"name": "road ochre", "hex": "#D0A15F", "usage": "roads", "weight": 0.08}
    ],
    "background": "#F7F3EA",
    "water": "#A8C7D8",
    "road": "#D0A15F",
    "text": {"primary": "#2A2520", "secondary": "#6F665A", "inverse": "#FFFFFF"},
    "accent": {"primary": "#D84A3A", "secondary": "#2C7C8C"}
  },
  "Theme&Design": {
    "global": "light",
    "theme": "warm editorial travel map",
    "design_keywords": ["warm", "editorial", "hand-drawn", "highly legible", "layered", "playful"],
    "visual_language": "低饱和纸张底色、柔和道路、水域偏灰蓝、重点元素用高对比暖色突出。",
    "label_design": "标签有明确主副层级，背景浅色，边框细，阴影轻，适合承载短句。",
    "route_design": "路线偏手绘曲线，线宽中等，可用箭头强调游览顺序。",
    "icon_design": "POI 图标适合生成透明背景的半扁平插画，轮廓清晰，颜色取自主强调色。"
  },
  "Stylesheet": {
    "global": "light",
    "mapboxStyle": "mapbox://styles/mapbox/light-v11",
    "layers": [
      {"target": "background", "paint": {"background-color": "#F7F3EA"}},
      {"target": "water", "paint": {"fill-color": "#A8C7D8"}},
      {"target": "landuse_park", "paint": {"fill-color": "#CFE3B4"}},
      {"target": "road_primary", "paint": {"line-color": "#D0A15F", "line-width": 1.6}},
      {"target": "road_secondary", "paint": {"line-color": "#E6CC9A", "line-width": 0.8}},
      {"target": "poi_label", "paint": {"text-color": "#2A2520", "text-halo-color": "#FFF7E8", "text-halo-width": 1.2}},
      {"target": "place_label", "paint": {"text-color": "#4E463D", "text-halo-color": "#FFF7E8", "text-halo-width": 1}},
      {"target": "road_label", "paint": {"text-color": "#8A765C", "text-halo-color": "#FFF7E8", "text-halo-width": 0.8}}
    ]
  }
}'''

        system_prompt = load_prompt("visual_structure.md").replace("{visual_example}", visual_example)
        
        self.system_prompt = system_prompt
    
    def image_to_base64(self, image_path: str) -> str:
        ext = os.path.splitext(image_path)[1].lower().lstrip('.')
        if ext not in ["jpg", "jpeg", "png", "gif", "bmp"]:
            raise ValueError(f"不支持的图片格式：{ext}")
        
        with open(image_path, "rb") as f:
            base64_data = base64.b64encode(f.read()).decode("utf-8")
        
        return f"data:image/{ext};base64,{base64_data}"

    def _default_visual_structure(self) -> dict:
        return {
            "Color": {
                "palette": [
                    {"name": "clean background", "hex": "#F7F8FA", "usage": "background", "weight": 0.45},
                    {"name": "primary text", "hex": "#222222", "usage": "text", "weight": 0.2},
                    {"name": "route accent", "hex": "#E4572E", "usage": "route and POI accent", "weight": 0.15},
                    {"name": "water blue", "hex": "#B9D7EA", "usage": "water", "weight": 0.1},
                    {"name": "park green", "hex": "#CDE7C7", "usage": "park", "weight": 0.1},
                ],
                "background": "#F7F8FA",
                "water": "#B9D7EA",
                "road": "#D7C7A3",
                "text": {"primary": "#222222", "secondary": "#666666", "inverse": "#FFFFFF"},
                "accent": {"primary": "#E4572E", "secondary": "#2B7C85"},
            },
            "Theme&Design": {
                "global": "light",
                "theme": "clean travel map",
                "design_keywords": ["clean", "legible", "warm", "balanced", "map-first"],
                "visual_language": "浅色地图基底，低噪声道路与水域，高对比路线和 POI。",
                "label_design": "标签层级清楚，主标题醒目，副标题紧凑。",
                "route_design": "路线颜色醒目，支持按顺序绘制箭头。",
                "icon_design": "透明背景、简洁插画式 POI 图标。",
            },
            "Stylesheet": {
                "global": "light",
                "mapboxStyle": "mapbox://styles/mapbox/light-v11",
                "layers": [
                    {"target": "background", "paint": {"background-color": "#EEF1F4"}},
                    {"target": "land", "paint": {"fill-color": "#E5E9EE"}},
                    {"target": "water", "paint": {"fill-color": "#BFD6E5"}},
                    {"target": "landuse_park", "paint": {"fill-color": "#D7E5D0"}},
                    {"target": "building", "paint": {"fill-color": "#D9DEE4", "fill-opacity": 0.72}},
                    {"target": "road_primary", "paint": {"line-color": "#CDBEA3", "line-width": 1.25}},
                    {"target": "road_secondary", "paint": {"line-color": "#E3D8C6", "line-width": 0.9}},
                    {"target": "poi_label", "paint": {"text-color": "#222222", "text-halo-color": "#FFFFFF", "text-halo-width": 1}},
                    {"target": "place_label", "paint": {"text-color": "#555555", "text-halo-color": "#FFFFFF", "text-halo-width": 1}},
                    {"target": "road_label", "paint": {"text-color": "#8A7A64", "text-halo-color": "#FFFFFF", "text-halo-width": 0.8}},
                ],
            },
        }
    
    def execute(self, state: AgentState) -> AgentState:
        print("👁️ [Node 2] 视觉结构解析: 正在分析图片中的视觉元素...")
        
        if not state.image_path or not os.path.exists(state.image_path):
            # 如果没有图片，使用默认视觉结构
            state.visual_structure = self._default_visual_structure()
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
                state.visual_structure = self._default_visual_structure()
                print("⚠️ [Node 2] 无法解析视觉结构，使用默认结构")
            
            print(f"✅ [Node 2] 视觉结构解析完成")
            print(f"   识别到的元素类型: {list(state.visual_structure.keys())}")
            
        except Exception as e:
            # 降级处理
            state.visual_structure = self._default_visual_structure()
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
