"""
Agent 工具函数和数据结构
"""

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
import re
import json


class AgentState(BaseModel):
    session_id: str = Field(..., description="会话唯一标识")
    user_text: str = Field(..., description="用户原始文本")
    image_path: Optional[str] = Field(None, description="参考图片路径")
    image_base64: Optional[str] = Field(None, description="Base64 编码的图片")
    
    intent_enriched: Optional[str] = Field(None, description="增强后的意图描述")
    global_title: Optional[str] = Field(None, description="全局标题")
    global_description: Optional[str] = Field(None, description="全局说明文字")
    visual_structure: Optional[Dict[str, Any]] = Field(None, description="视觉结构解析结果")
    
    geojson_data: Optional[Dict[str, Any]] = Field(None, description="生成的 GeoJSON 数据")
    style_code: Optional[Dict[str, Any]] = Field(None, description="生成的 Mapbox 样式代码")
    
    error: Optional[str] = Field(None, description="错误信息")
    retry_count: int = Field(0, description="重试次数")


def _escape_prompt_braces(s: str) -> str:
    """把示例 JSON 等文本中的 { } 转义为 {{ }}，避免被 ChatPromptTemplate 当成变量占位符。"""
    return s.replace("{", "{{").replace("}", "}}")


def _cleanup_json_text(s: str) -> str:
    """清理常见的非严格 JSON 输出（代码块围栏、尾随逗号）。"""
    s = (s or "").strip()
    if s.startswith("```"):
        # 去掉 ```json ... ``` 围栏
        s = s.strip()
        # 去掉第一行 ```json / ``` 的标记
        if s.startswith("```"):
            s = s.split("\n", 1)[1] if "\n" in s else ""
        if s.endswith("```"):
            s = s.rsplit("```", 1)[0]
        s = s.strip()
        if s.lower().startswith("json"):
            s = s[4:].lstrip()
    # 去掉尾随逗号：",}" 或 ",]"
    s = s.replace(",}", "}").replace(",]", "]")
    return s


def _coerce_json_like_literals(s: str) -> str:
    """把常见的"类 JSON"字面量替换为标准 JSON（尽量不误伤）。"""
    if not s:
        return s
    # 先处理最常见的 python/JS 字面量（多数情况下不出现在字符串里）
    s = re.sub(r"\bNone\b", "null", s)
    s = re.sub(r"\bTrue\b", "true", s)
    s = re.sub(r"\bFalse\b", "false", s)
    # 一些模型会输出 NaN/Infinity
    s = re.sub(r"\bNaN\b", "null", s)
    s = re.sub(r"\bInfinity\b", "null", s)
    s = re.sub(r"\b-Infinity\b", "null", s)
    return s


def _extract_first_json_object(text: str) -> Optional[str]:
    """从文本中提取第一个最外层 JSON 对象（{...}）。"""
    if not text:
        return None
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    return text[start:end + 1]


def _robust_json_loads(text: str) -> Any:
    """尽量把 LLM 输出解析成 JSON，失败则抛出 JSONDecodeError。"""
    cleaned = _cleanup_json_text(text)
    cleaned = _coerce_json_like_literals(cleaned)
    return json.loads(cleaned)
