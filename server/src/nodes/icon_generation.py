import base64
import os
import re
from collections import Counter, deque
from pathlib import Path
from typing import Any

import requests
from PIL import Image

from ..utils.agent_utils import AgentState


class IconGenerationNode:
    """Node 6: Generate raster POI icons from Point icon descriptions."""

    PROMPT_NAME = "icon_generation"
    PROMPT_VERSION = "v0.1"

    def __init__(self):
        self.model = os.getenv("ICON_IMAGE_MODEL", "gpt-image-2")
        self.size = os.getenv("ICON_IMAGE_SIZE", "1024x1024")
        self.output_format = os.getenv("ICON_IMAGE_OUTPUT_FORMAT", "png")
        self.quality = os.getenv("ICON_IMAGE_QUALITY", "medium")
        self.timeout = int(os.getenv("ICON_IMAGE_TIMEOUT", "40"))
        self.transparent_postprocess = os.getenv("ICON_TRANSPARENCY_POSTPROCESS", "true").strip().lower() not in {
            "0", "false", "no", "off"
        }

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
            "True transparent PNG alpha background, no checkerboard, no white or gray square, "
            "centered object with generous empty transparent padding, no text, no letters, no map screenshot, "
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

    def _generate_image(self, client: Any, prompt: str) -> Any:
        kwargs = {
            "model": self.model,
            "prompt": prompt,
            "size": self.size,
        }
        transparent_kwargs = {
            **kwargs,
            "background": "transparent",
            "output_format": self.output_format,
            "quality": self.quality,
        }
        try:
            return client.images.generate(**transparent_kwargs)
        except TypeError:
            return client.images.generate(**kwargs)
        except Exception as exc:
            message = str(exc).lower()
            if any(key in message for key in ["background", "output_format", "quality", "unsupported", "unknown parameter"]):
                return client.images.generate(**kwargs)
            raise

    def _quantize_rgb(self, rgb: tuple[int, int, int]) -> tuple[int, int, int]:
        return tuple(int(round(channel / 16) * 16) for channel in rgb)

    def _is_neutral_background_color(self, rgb: tuple[int, int, int]) -> bool:
        max_channel = max(rgb)
        min_channel = min(rgb)
        mean = sum(rgb) / 3
        return (max_channel - min_channel <= 24 and mean >= 145) or mean >= 238

    def _color_distance(self, a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
        return sum((a[index] - b[index]) ** 2 for index in range(3)) ** 0.5

    def _postprocess_transparency(self, output_path: Path) -> bool:
        """Turn model-drawn checkerboard/near-white backgrounds into real alpha."""
        try:
            image = Image.open(output_path).convert("RGBA")
        except Exception:
            return False

        width, height = image.size
        pixels = image.load()
        if width < 2 or height < 2:
            return False

        alpha = image.getchannel("A")
        if alpha.getextrema()[0] < 16:
            image.save(output_path, "PNG")
            return True

        border_pixels = []
        for x in range(width):
            border_pixels.append(pixels[x, 0][:3])
            border_pixels.append(pixels[x, height - 1][:3])
        for y in range(height):
            border_pixels.append(pixels[0, y][:3])
            border_pixels.append(pixels[width - 1, y][:3])

        common = Counter(self._quantize_rgb(rgb) for rgb in border_pixels).most_common(8)
        background_palette = [
            rgb for rgb, _ in common
            if self._is_neutral_background_color(rgb)
        ]
        if not background_palette:
            background_palette = [self._quantize_rgb(rgb) for rgb, _ in common[:2]]

        def looks_like_background(x: int, y: int) -> bool:
            r, g, b, a = pixels[x, y]
            if a < 16:
                return True
            rgb = (r, g, b)
            if not self._is_neutral_background_color(rgb):
                return False
            return any(self._color_distance(rgb, bg) <= 42 for bg in background_palette)

        transparent = bytearray(width * height)
        queue: deque[tuple[int, int]] = deque()

        def enqueue(x: int, y: int) -> None:
            index = y * width + x
            if transparent[index] or not looks_like_background(x, y):
                return
            transparent[index] = 1
            queue.append((x, y))

        for x in range(width):
            enqueue(x, 0)
            enqueue(x, height - 1)
        for y in range(height):
            enqueue(0, y)
            enqueue(width - 1, y)

        while queue:
            x, y = queue.popleft()
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < width and 0 <= ny < height:
                    enqueue(nx, ny)

        changed = False
        for y in range(height):
            for x in range(width):
                index = y * width + x
                if transparent[index]:
                    r, g, b, _ = pixels[x, y]
                    pixels[x, y] = (r, g, b, 0)
                    changed = True

        if changed:
            image.save(output_path, "PNG")
        return changed

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
            "output_format": self.output_format,
            "transparent_background": True,
            "transparency_postprocess": self.transparent_postprocess,
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
                response = self._generate_image(client, prompt)
                if not self._write_image_from_response(response, output_path):
                    raise RuntimeError("image response did not include b64_json or downloadable url")
                if self.transparent_postprocess:
                    self._postprocess_transparency(output_path)
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
