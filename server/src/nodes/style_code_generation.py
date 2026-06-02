import json
import re
from typing import Any

from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from ..utils.agent_utils import AgentState, _extract_first_json_object, _robust_json_loads
from ..utils.prompt_loader import load_prompt
from ..validators.schema_validators import validate_style_spec


ROUTE_STYLE_ALIASES = {
    "straight": "straight",
    "line": "straight",
    "direct": "straight",
    "直线": "straight",
    "bezier": "bezier",
    "贝塞尔": "bezier",
    "曲线": "bezier",
    "navigation": "navigation",
    "导航": "navigation",
    "导航路线": "navigation",
}


class StyleCodeGenerationNode:
    """Node 4: 样式推演与结构化渲染合同.

    输入: 参考图片 + VisualStructure(Color/Theme&Design/Stylesheet) + GeoJSON
    输出: Point/Route/Label/Global 四类前端渲染样式，不生成 HTML，不生成图标文件。
    """

    PROMPT_NAME = "style_code_generation"
    PROMPT_VERSION = "v0.4"

    def __init__(self, llm: ChatOpenAI):
        self.llm = llm
        self.system_prompt = load_prompt("style_code_generation.md")

    def _as_list(self, value: Any) -> list[dict]:
        if not isinstance(value, list):
            return []
        return [item for item in value if isinstance(item, dict)]

    def _slug(self, value: Any, fallback: str) -> str:
        text = str(value or "").strip().lower()
        if text.startswith("point_"):
            text = text[6:]
        text = re.sub(r"[^a-z0-9_]+", "_", text)
        text = re.sub(r"_+", "_", text).strip("_")
        return text or fallback

    def _normalize_route_style(self, value: Any) -> str:
        key = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", str(value or "").strip().lower())
        return ROUTE_STYLE_ALIASES.get(key, "bezier")

    def _normalize_line_pattern(self, item: dict) -> str:
        value = (
            item.get("linePattern")
            or item.get("pattern")
            or item.get("stroke")
            or item.get("line_style")
            or item.get("lineStyle")
        )
        text = str(value or "").strip().lower()
        if text in {"dashed", "dash", "虚线"} or item.get("dasharray") or item.get("dashArray"):
            return "dashed"
        return "solid"

    def _normalize_label_hierarchy(self, value: Any, fallback: str) -> str:
        aliases = {
            "核心标签": "core",
            "core": "core",
            "primary": "core",
            "次要标签": "secondary",
            "secondary": "secondary",
            "详细标签": "detail",
            "detail": "detail",
        }
        return aliases.get(str(value or "").strip(), fallback)

    def _normalize_label_content_type(self, value: Any, hierarchy: str) -> str:
        aliases = {
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
        normalized = aliases.get(str(value or "").strip().lower())
        if normalized:
            return normalized
        return "title_script_extra" if hierarchy == "detail" else "title_script"

    def _number(self, value: Any, default: int, minimum: int, maximum: int) -> int:
        if isinstance(value, (int, float)):
            number = int(value)
        else:
            match = re.search(r"\d+", str(value or ""))
            number = int(match.group(0)) if match else default
        return max(minimum, min(maximum, number))

    def _normalize_point_styles(self, style_code: dict) -> list[dict]:
        points = []
        seen: set[str] = set()
        for index, item in enumerate(self._as_list(style_code.get("Point")), start=1):
            category = self._slug(item.get("category") or item.get("visual_id"), f"poi_{index}")
            visual_id = item.get("visual_id") or f"point_{category}"
            if not str(visual_id).startswith("point_"):
                visual_id = f"point_{category}"
            visual_id = str(visual_id)
            if visual_id in seen:
                continue
            seen.add(visual_id)

            icon_description = (
                item.get("icon描述")
                or item.get("iconDescription")
                or item.get("description")
                or f"{category} 类 POI 图标，透明背景，清晰轮廓，与参考图地图风格一致"
            )
            normalized = dict(item)
            normalized.update(
                {
                    "visual_id": visual_id,
                    "category": category,
                    "icon描述": str(icon_description),
                    "style": item.get("style") if isinstance(item.get("style"), dict) else {},
                }
            )
            for stale_key in ["iconSvg", "iconDataUrl", "iconUrl", "url"]:
                normalized.pop(stale_key, None)
            points.append(normalized)

        if points:
            return points
        return [
            {
                "visual_id": "point_poi",
                "category": "poi",
                "icon描述": "精致旅行 POI 小图标，透明背景，轮廓清晰，色彩取自主强调色",
                "style": {"color": "#E4572E", "size": 28},
            }
        ]

    def _normalize_route_styles(self, style_code: dict) -> list[dict]:
        routes = []
        for index, item in enumerate(self._as_list(style_code.get("Route")), start=1):
            visual_id = str(item.get("visual_id") or f"route_D{index}")
            normalized = dict(item)
            normalized.update(
                {
                    "visual_id": visual_id,
                    "style": self._normalize_route_style(item.get("style")),
                    "Color": item.get("Color") or item.get("color") or item.get("lineColor") or "#E4572E",
                    "color": item.get("color") or item.get("Color") or item.get("lineColor") or "#E4572E",
                    "width": self._number(item.get("width") or item.get("lineWidth"), 4, 1, 12),
                    "linePattern": self._normalize_line_pattern(item),
                    "dashArray": item.get("dashArray") or item.get("dasharray") or ([2, 2] if self._normalize_line_pattern(item) == "dashed" else []),
                    "arrow": item.get("arrow", True),
                }
            )
            routes.append(normalized)

        return routes or [
            {
                "visual_id": "route_D1",
                "style": "bezier",
                "Color": "#E4572E",
                "color": "#E4572E",
                "width": 4,
                "linePattern": "solid",
                "dashArray": [],
                "arrow": True,
            }
        ]

    def _default_label_style(self, hierarchy: str) -> dict:
        palette = {
            "core": ("#FFFFFF", "#1F2937", "#E4572E", 220, 84),
            "secondary": ("#FFFFFF", "#374151", "#B8C2CC", 190, 68),
            "detail": ("#FFFFFF", "#4B5563", "#D9DEE4", 170, 76),
        }
        background, color, border, width, height = palette[hierarchy]
        return {
            "backgroundColor": background,
            "color": color,
            "borderColor": border,
            "borderWidth": 1,
            "borderRadius": 6,
            "padding": "8px 10px",
            "boxShadow": "0 3px 10px rgba(0,0,0,0.14)",
            "fontFamily": "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
            "fontSize": 13 if hierarchy == "core" else 12,
            "lineHeight": 1.35,
            "_defaultWidth": width,
            "_defaultHeight": height,
        }

    def _normalize_label_styles(self, style_code: dict) -> list[dict]:
        labels = []
        seen: set[str] = set()
        fallback_hierarchy = ["core", "secondary", "detail"]
        for index, item in enumerate(self._as_list(style_code.get("Label")), start=1):
            hierarchy = self._normalize_label_hierarchy(
                item.get("hierarchy") or item.get("label_level"),
                fallback_hierarchy[min(index - 1, len(fallback_hierarchy) - 1)],
            )
            visual_id = str(item.get("visual_id") or f"label_{hierarchy}")
            if visual_id in seen:
                continue
            seen.add(visual_id)
            style = item.get("style") if isinstance(item.get("style"), dict) else {}
            if not style:
                style = self._default_label_style(hierarchy)
            normalized = dict(item)
            normalized.update(
                {
                    "visual_id": visual_id,
                    "hierarchy": hierarchy,
                    "content_type": self._normalize_label_content_type(
                        item.get("content_type") or item.get("label_content_type"),
                        hierarchy,
                    ),
                    "width": self._number(item.get("width") or style.get("_defaultWidth"), 190, 96, 320),
                    "height": self._number(item.get("height") or style.get("_defaultHeight"), 68, 32, 180),
                    "style": {k: v for k, v in style.items() if not str(k).startswith("_default")},
                }
            )
            labels.append(normalized)

        if labels:
            return labels

        return [
            {
                "visual_id": f"label_{hierarchy}",
                "hierarchy": hierarchy,
                "content_type": "title_script_extra" if hierarchy == "detail" else "title_script",
                "width": self._default_label_style(hierarchy)["_defaultWidth"],
                "height": self._default_label_style(hierarchy)["_defaultHeight"],
                "style": {k: v for k, v in self._default_label_style(hierarchy).items() if not k.startswith("_default")},
            }
            for hierarchy in ["core", "secondary", "detail"]
        ]

    def _normalize_global_styles(self, style_code: dict) -> list[dict]:
        globals_out = []
        defaults = [
            {
                "visual_id": "global_title",
                "placement": {"position": "fixed", "top": "15%", "left": 0, "width": "100%"},
                "content_type": "title_script_extra",
            },
            {
                "visual_id": "global_summary",
                "placement": {"position": "fixed", "bottom": "10%", "left": 0, "width": "100%"},
                "content_type": "title_script",
            },
        ]
        source_items = self._as_list(style_code.get("Global"))[:2]
        for index in range(max(len(source_items), 2)):
            source = source_items[index] if index < len(source_items) else {}
            default = defaults[index]
            style = source.get("style") if isinstance(source.get("style"), dict) else {}
            normalized = dict(source)
            normalized.update(
                {
                    "visual_id": source.get("visual_id") or default["visual_id"],
                    "placement": default["placement"],
                    "content_type": default["content_type"],
                    "style": style
                    or {
                        "color": "#1F2937",
                        "fontFamily": "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
                        "textAlign": "center",
                        "fontWeight": 700 if index == 0 else 500,
                    },
                }
            )
            globals_out.append(normalized)
        return globals_out[:2]

    def _normalize_style_code(self, style_code: dict) -> dict:
        """Keep only the new Point/Route/Label/Global contract."""
        if not isinstance(style_code, dict):
            return self._default_style_code("style_code is not an object")
        return {
            "Point": self._normalize_point_styles(style_code),
            "Route": self._normalize_route_styles(style_code),
            "Label": self._normalize_label_styles(style_code),
            "Global": self._normalize_global_styles(style_code),
        }

    def _default_style_code(self, reason: str = "") -> dict:
        fallback = {
            "Point": [
                {
                    "visual_id": "point_poi",
                    "category": "poi",
                    "icon描述": "精致旅行 POI 小图标，透明背景，轮廓清晰，色彩取自主强调色",
                    "style": {"color": "#E4572E", "size": 28},
                }
            ],
            "Route": [
                {
                    "visual_id": "route_D1",
                    "style": "bezier",
                    "Color": "#E4572E",
                    "color": "#E4572E",
                    "width": 4,
                    "linePattern": "solid",
                    "dashArray": [],
                    "arrow": True,
                }
            ],
            "Label": self._normalize_label_styles({}),
            "Global": self._normalize_global_styles({}),
        }
        if reason:
            fallback["_style_generation_error"] = reason
        return fallback

    def execute(self, state: AgentState) -> AgentState:
        print("🎨 [Node 4] 样式推演与结构化渲染合同: 正在生成前端样式 JSON...")

        if not state.visual_structure:
            state.error = "缺少视觉结构解析结果"
            print("❌ [Node 4] 缺少视觉结构")
            return state

        if not state.geojson_data:
            state.error = "缺少 GeoJSON 数据"
            print("❌ [Node 4] 缺少 GeoJSON 数据")
            return state

        try:
            messages = [
                SystemMessage(content=self.system_prompt),
                HumanMessage(
                    content=[
                        {"type": "text", "text": f"视觉结构：\n{json.dumps(state.visual_structure, ensure_ascii=False)}"},
                        {"type": "text", "text": f"GeoJSON 数据：\n{json.dumps(state.geojson_data, ensure_ascii=False)}"},
                        {"type": "text", "text": "请生成 Point/Route/Label/Global 四类前端渲染样式 JSON："},
                    ]
                ),
            ]

            if state.image_base64:
                messages[1].content.insert(
                    0,
                    {
                        "type": "image_url",
                        "image_url": {"url": state.image_base64},
                    },
                )

            response = self.llm.invoke(messages)
            json_str = _extract_first_json_object(response.content)
            if not json_str:
                raise ValueError("无法解析 Style Code JSON")

            try:
                style_code = json.loads(json_str)
            except json.JSONDecodeError:
                style_code = _robust_json_loads(json_str)

            state.style_code = self._normalize_style_code(style_code)
            print("✅ [Node 4] Style Code 生成完成")
            print(f"   生成的样式类别: {list(state.style_code.keys())}")

        except Exception as exc:
            state.style_code = self._default_style_code(str(exc))
            print(f"⚠️ [Node 4] Style Code 生成失败，已降级为默认结构化样式: {exc}")

        schema_report = validate_style_spec(state.style_code)
        if schema_report["valid"]:
            print("✅ [Node 4] Style schema 校验通过")
        else:
            print(f"⚠️ [Node 4] Style schema 校验失败: {schema_report['errors']}")

        return state
