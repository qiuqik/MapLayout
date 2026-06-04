import base64
import os
import re
from pathlib import Path
from typing import Any

import requests

from ..utils.agent_utils import AgentState


class IconGenerationNode:
    """Node 6: Generate raster POI icons from Point icon descriptions."""

    PROMPT_NAME = "icon_generation"
    PROMPT_VERSION = "v0.1"

    def __init__(self):
        self.model = os.getenv("ICON_IMAGE_MODEL", "gpt-image-2")
        self.size = os.getenv("ICON_IMAGE_SIZE", "256x256")
        self.timeout = int(os.getenv("ICON_IMAGE_TIMEOUT", "40"))

    def _enabled(self) -> bool:
        enabled = os.getenv("ENABLE_ICON_IMAGE_GENERATION", "true").strip().lower()
        return enabled not in {"0", "false", "no", "off"}

    def _slug(self, value: Any, fallback: str) -> str:
        text = str(value or "").strip().lower()
        text = re.sub(r"[^a-z0-9_]+", "_", text)
        text = re.sub(r"_+", "_", text).strip("_")
        return text or fallback

    def _build_prompt(self, point_style: dict) -> str:
        description = (
            point_style.get("icon描述")
            or point_style.get("iconDescription")
            or point_style.get("description")
            or "travel map POI icon"
        )
        category = point_style.get("category") or point_style.get("visual_id") or "poi"
        color = ""
        style = point_style.get("style")
        if isinstance(style, dict):
            color = style.get("color") or style.get("backgroundColor") or ""
        return (
            "Create one small raster icon for a travel map POI. "
            "Transparent background, centered object, no text, no letters, no map screenshot, "
            "no SVG/vector flatness, crisp silhouette, polished illustration quality. "
            f"Category: {category}. "
            f"Reference style description: {description}. "
            f"Preferred accent color: {color or 'match the style description'}."
        )

    def _client(self):
        from openai import OpenAI

        client_kwargs = {
            "api_key": os.getenv("OPENAI_API_KEY"),
            "timeout": self.timeout,
        }
        base_url = os.getenv("OPENAI_IMAGE_BASE_URL") or os.getenv("HTTP_PROXY")
        if base_url:
            client_kwargs["base_url"] = base_url
        return OpenAI(**client_kwargs)

    def _write_image_from_response(self, response: Any, output_path: Path) -> bool:
        data = response.data[0] if getattr(response, "data", None) else None
        if data is None:
            return False

        b64_json = getattr(data, "b64_json", None)
        if b64_json:
            output_path.write_bytes(base64.b64decode(b64_json))
            return True

        image_url = getattr(data, "url", None)
        if image_url:
            res = requests.get(image_url, timeout=self.timeout)
            if res.ok:
                output_path.write_bytes(res.content)
                return True
        return False

    def execute(self, state: AgentState, session_dir: str) -> AgentState:
        print("🖼️ [Node 6] Icon generation: 正在根据 Point.icon描述 生成 POI 图标...")

        if not state.style_code:
            state.error = "缺少样式代码，无法生成图标"
            print("❌ [Node 6] 缺少样式代码")
            return state

        icon_meta = {
            "enabled": self._enabled(),
            "model": self.model,
            "size": self.size,
            "generated_count": 0,
            "errors": [],
        }
        state.style_code["_icon_generation"] = icon_meta

        point_styles = state.style_code.get("Point") if isinstance(state.style_code, dict) else None
        if not isinstance(point_styles, list) or not point_styles:
            return state

        icon_dir = Path(session_dir) / "icon"
        icon_dir.mkdir(parents=True, exist_ok=True)

        if not self._enabled():
            print("ℹ️ [Node 6] Icon generation disabled by ENABLE_ICON_IMAGE_GENERATION")
            return state

        if not os.getenv("OPENAI_API_KEY"):
            icon_meta["errors"].append("OPENAI_API_KEY is not configured")
            print("⚠️ [Node 6] 未配置 OPENAI_API_KEY，跳过图标生成")
            return state

        try:
            client = self._client()
        except Exception as exc:
            icon_meta["errors"].append(f"OpenAI image client unavailable: {exc}")
            print(f"⚠️ [Node 6] OpenAI image client unavailable: {exc}")
            return state

        for index, point_style in enumerate(point_styles, start=1):
            if not isinstance(point_style, dict):
                continue
            visual_id = point_style.get("visual_id") or f"point_{index}"
            filename = f"{self._slug(visual_id, f'point_{index}')}.png"
            output_path = icon_dir / filename
            prompt = point_style.get("iconPrompt") or self._build_prompt(point_style)

            try:
                response = client.images.generate(
                    model=self.model,
                    prompt=prompt,
                    size=self.size,
                )
                if not self._write_image_from_response(response, output_path):
                    raise RuntimeError("image response did not include b64_json or downloadable url")
                point_style["url"] = f"/api/multimodal/session/{state.session_id}/icon/{filename}"
                point_style["icon_path"] = f"icon/{filename}"
                point_style["icon_model"] = self.model
                icon_meta["generated_count"] += 1
                print(f"   ✅ {visual_id} -> {output_path.name}")
            except Exception as exc:
                message = f"{visual_id}: {exc}"
                point_style["icon_error"] = str(exc)
                icon_meta["errors"].append(message)
                print(f"⚠️ [Node 6] 图标生成失败 {message}")

        return state
