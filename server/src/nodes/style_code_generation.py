import os

from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from ..utils.agent_utils import AgentState, _extract_first_json_object, _robust_json_loads
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
    PROMPT_VERSION = "v0.2"
    
    def __init__(self, llm: ChatOpenAI):
        self.llm = llm
        
        system_prompt = load_prompt("style_code_generation.md")
        
        self.system_prompt = system_prompt

    def _visual_description_by_id(self, visual_structure: dict | None, category: str) -> dict[str, str]:
        if not isinstance(visual_structure, dict):
            return {}
        descriptions = {}
        for item in visual_structure.get(category) or []:
            if isinstance(item, dict) and item.get("visual_id"):
                descriptions[item["visual_id"]] = item.get("description", "")
        return descriptions

    def _normalize_style_code(self, style_code: dict, visual_structure: dict | None = None) -> dict:
        """Convert legacy Card/SVG styles into unified responsive Label + image-icon styles."""
        if not isinstance(style_code, dict):
            return style_code

        normalized = dict(style_code)
        visual_point_descriptions = self._visual_description_by_id(visual_structure, "Point")

        labels = list(normalized.get("Label") or [])
        for card in normalized.get("Card") or []:
            if not isinstance(card, dict):
                continue
            migrated = dict(card)
            migrated.setdefault("content_type", "title_script_extra")
            migrated.setdefault("hierarchy", "detail")
            labels.append(migrated)

        deduped_labels = []
        seen_label_ids = set()
        for index, label in enumerate(labels, start=1):
            if not isinstance(label, dict):
                continue
            item = dict(label)
            item.setdefault("visual_id", f"label_vis_{index}")
            if item["visual_id"] in seen_label_ids:
                continue
            seen_label_ids.add(item["visual_id"])
            item.setdefault("content_type", item.get("label_content_type") or "title_script")
            item.setdefault("hierarchy", item.get("label_hierarchy") or "secondary")
            deduped_labels.append(item)
        normalized["Label"] = deduped_labels
        normalized["Card"] = []
        normalized["Area"] = []

        if not normalized.get("BaseMap"):
            normalized["BaseMap"] = [{"visual_id": "basemap_1", "type": "standard", "tintColor": "#FFFFFF", "tintOpacity": 0}]
        for base_map in normalized.get("BaseMap") or []:
            if isinstance(base_map, dict):
                base_map.setdefault("type", "standard")

        for point in normalized.get("Point") or []:
            if not isinstance(point, dict):
                continue
            visual_id = point.get("visual_id")
            source_description = point.get("iconDescription") or visual_point_descriptions.get(visual_id, "")
            point["iconDescription"] = source_description or "适合旅游地图 POI 的精致小图标，透明背景，轮廓清晰"
            point.setdefault(
                "iconPrompt",
                (
                    "A polished small travel map POI icon, transparent background, "
                    f"clear silhouette, style description: {point['iconDescription']}. "
                    "Isolated centered object, no text, no map pin SVG, high contrast."
                ),
            )
            point.setdefault("iconFallbackColor", point.get("color") or "#E4572E")
            point.pop("iconSvg", None)

        self._generate_point_icon_images(normalized)
        return normalized

    def _generate_point_icon_images(self, style_code: dict) -> None:
        """Best-effort DALL·E/gpt-image icon generation from style-code prompts."""
        enabled = os.getenv("ENABLE_ICON_IMAGE_GENERATION", "true").strip().lower()
        if enabled in {"0", "false", "no", "off"}:
            return

        try:
            from openai import OpenAI
        except Exception as exc:
            print(f"⚠️ [Node 4] OpenAI image client unavailable, using icon fallback: {exc}")
            return

        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            return

        client_kwargs = {"api_key": api_key, "timeout": 20}
        base_url = os.getenv("OPENAI_IMAGE_BASE_URL") or os.getenv("HTTP_PROXY")
        if base_url:
            client_kwargs["base_url"] = base_url
        client = OpenAI(**client_kwargs)
        model = os.getenv("ICON_IMAGE_MODEL", "gpt-image-2")
        size = os.getenv("ICON_IMAGE_SIZE", "256x256")

        for point in style_code.get("Point") or []:
            if not isinstance(point, dict) or point.get("iconDataUrl") or point.get("iconUrl"):
                continue
            prompt = point.get("iconPrompt") or point.get("iconDescription")
            if not prompt:
                continue
            try:
                response = client.images.generate(
                    model=model,
                    prompt=prompt,
                    size=size,
                )
                data = response.data[0] if response.data else None
                if data is None:
                    continue
                b64_json = getattr(data, "b64_json", None)
                url = getattr(data, "url", None)
                if b64_json:
                    point["iconDataUrl"] = f"data:image/png;base64,{b64_json}"
                elif url:
                    point["iconUrl"] = url
            except Exception as exc:
                print(f"⚠️ [Node 4] Icon image generation failed for {point.get('visual_id')}: {exc}")
    
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
                
                state.style_code = self._normalize_style_code(style_code, state.visual_structure)
                # 清洗旧模板中的 transform/固定宽高，避免和前端布局引擎冲突
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
                        "visual_id": "basemap_1",
                        "type": "standard",
                        "tintColor": "#F4F6F9",
                        "tintOpacity": 0.12
                    }
                ],
                "Point": [
                    {
                        "visual_id": "point_vis_1",
                        "iconDescription": "橙红色精致旅游 POI 图标，透明背景，圆润但清晰",
                        "iconPrompt": "A polished orange-red travel map POI icon, transparent background, centered object, high contrast, no text, no SVG, no map screenshot.",
                        "iconFallbackColor": "#FF5722"
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
                "Label": [
                    {
                        "visual_id": "label_vis_1",
                        "content_type": "title_script",
                        "hierarchy": "secondary",
                        "template": "<div style='background:#FFF; border:1px solid #E0E0E0; border-radius:6px; padding:calc(var(--map-label-scale, 1) * 7px) calc(var(--map-label-scale, 1) * 10px); max-width:calc(var(--map-label-scale, 1) * 190px); box-shadow:0 3px 8px rgba(0,0,0,0.12); line-height:1.35;'><div style='font-size:calc(var(--map-label-scale, 1) * 13px); font-weight:700; color:#333;'>{properties.label_title}</div><div style='font-size:calc(var(--map-label-scale, 1) * 11px); color:#666;'>{properties.label_script}</div></div>"
                    }
                ],
                "Card": [],
                "Area": [],
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
