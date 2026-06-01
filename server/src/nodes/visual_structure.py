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
    PROMPT_VERSION = "v0.2"
    
    def __init__(self, llm: ChatOpenAI):
        self.llm = llm
        
        visual_example = '''{
  "_style_extraction_thought": "观察到图中有 9 个橙色卡片式文字块和 9 个红色箭头，虽然文字不同，但文字块样式完全一致，因此合并为 1 个 detail Label 类和 1 个 Edge 类；观察到没有必要的真实区域面，因此不输出 Area；观察到路线有黑色实线和红色虚线两种样式，因此拆分为 2 个 Route 类...",
  "BaseMap": [
    {
      "visual_id": "basemap_illustration",
      "type": "standard",
      "description": "浅色手绘地图气质，背景偏暖，水系和道路对比度较低"
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
      "description": "白底黑字短标签，圆角较小，字体醒目",
      "content_type": "title",
      "hierarchy": "secondary",
      "anchored_to": ["point_vis_1", "point_vis_2"]
    },
    {
      "visual_id": "label_detail_1",
      "description": "绿色背景详细标签，包含标题、短说明和补充信息三层文字",
      "content_type": "title_script_extra",
      "hierarchy": "detail",
      "anchored_to": "point_vis_1"
    }
  ],
  "Edge": [
    {
      "visual_id": "edge_vis_1",
      "description": "红色箭头，从卡片指向POI位置",
      "anchored_from": "label_detail_1",
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

    def _normalize_visual_structure(self, visual_structure: dict) -> dict:
        """Normalize legacy visual extraction into the unified Label model."""
        if not isinstance(visual_structure, dict):
            return visual_structure

        normalized = dict(visual_structure)
        labels = list(normalized.get("Label") or [])

        # Legacy Card styles now behave as detail labels.
        for card in normalized.get("Card") or []:
            if not isinstance(card, dict):
                continue
            migrated = dict(card)
            migrated.setdefault("content_type", "title_script_extra")
            migrated.setdefault("hierarchy", "detail")
            labels.append(migrated)

        content_aliases = {
            "只包含title": "title",
            "只包含 title": "title",
            "title": "title",
            "包含title+script": "title_script",
            "包含 title+script": "title_script",
            "title+script": "title_script",
            "title_script": "title_script",
            "title+script+extra info": "title_script_extra",
            "title_script_extra": "title_script_extra",
        }
        hierarchy_aliases = {
            "核心标签": "core",
            "core": "core",
            "次要标签": "secondary",
            "secondary": "secondary",
            "详细标签": "detail",
            "detail": "detail",
        }

        deduped_labels = []
        seen_ids = set()
        for index, label in enumerate(labels, start=1):
            if not isinstance(label, dict):
                continue
            item = dict(label)
            item.setdefault("visual_id", f"label_vis_{index}")
            visual_id = item.get("visual_id")
            if visual_id in seen_ids:
                continue
            seen_ids.add(visual_id)
            item["content_type"] = content_aliases.get(
                str(item.get("content_type") or item.get("label_content_type") or "").strip(),
                "title_script" if index == 1 else "title_script_extra",
            )
            item["hierarchy"] = hierarchy_aliases.get(
                str(item.get("hierarchy") or item.get("label_hierarchy") or "").strip(),
                "secondary" if index == 1 else "detail",
            )
            deduped_labels.append(item)

        normalized["Label"] = deduped_labels
        normalized["Card"] = []
        normalized["Area"] = []

        if not normalized.get("BaseMap"):
            normalized["BaseMap"] = [
                {
                    "visual_id": "basemap_1",
                    "type": "standard",
                    "description": "标准地图底图，颜色跟随参考图整体气质",
                }
            ]

        return normalized
    
    def execute(self, state: AgentState) -> AgentState:
        print("👁️ [Node 2] 视觉结构解析: 正在分析图片中的视觉元素...")
        
        if not state.image_path or not os.path.exists(state.image_path):
            # 如果没有图片，使用默认视觉结构
            state.visual_structure = {
                "BaseMap": [{"visual_id": "basemap_1", "type": "standard", "description": "标准地图底图"}],
                "Route": [{"visual_id": "route_vis_1", "description": "所有 POI 的连线，表示导航路线"}],
                "Point": [{"visual_id": "point_vis_1", "description": "POI 坐标图标"}],
                "Label": [{"visual_id": "label_vis_1", "description": "POI 信息标签", "content_type": "title_script", "hierarchy": "secondary"}],
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
                    "BaseMap": [{"visual_id": "basemap_1", "type": "standard", "description": "标准地图底图"}],
                    "Route": [{"visual_id": "route_vis_1", "description": "所有 POI 的连线，表示导航路线"}],
                    "Point": [{"visual_id": "point_vis_1", "description": "POI 坐标图标"}],
                    "Label": [{"visual_id": "label_vis_1", "description": "POI 信息标签", "content_type": "title_script", "hierarchy": "secondary"}]
                }
                print("⚠️ [Node 2] 无法解析视觉结构，使用默认结构")

            state.visual_structure = self._normalize_visual_structure(state.visual_structure)
            
            print(f"✅ [Node 2] 视觉结构解析完成")
            print(f"   识别到的元素类型: {list(state.visual_structure.keys())}")
            
        except Exception as e:
            # 降级处理
            state.visual_structure = {
                "BaseMap": [{"visual_id": "basemap_1", "type": "standard", "description": "标准地图底图"}],
                "Route": [{"visual_id": "route_vis_1", "description": "所有 POI 的连线，表示导航路线"}],
                "Point": [{"visual_id": "point_vis_1", "description": "POI 坐标图标"}],
                "Label": [{"visual_id": "label_vis_1", "description": "POI 信息标签", "content_type": "title_script", "hierarchy": "secondary"}]
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
