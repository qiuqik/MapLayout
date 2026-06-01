from typing import Any, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


STYLE_CATEGORIES = ["Point", "Route", "Label", "Global"]


class StyleElement(BaseModel):
    model_config = ConfigDict(extra="allow")

    visual_id: Optional[str] = None


class StyleSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    Point: List[StyleElement] = Field(default_factory=list)
    Route: List[StyleElement] = Field(default_factory=list)
    Label: List[StyleElement] = Field(default_factory=list)
    Global: List[StyleElement] = Field(default_factory=list)

    @field_validator(*STYLE_CATEGORIES, mode="before")
    @classmethod
    def ensure_category_lists(cls, value: Any) -> Any:
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError("style categories must be arrays")
        return value
