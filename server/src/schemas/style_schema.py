from typing import Any, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .visual_schema import VISUAL_CATEGORIES


class StyleElement(BaseModel):
    model_config = ConfigDict(extra="allow")

    visual_id: Optional[str] = None


class BaseMapStyle(StyleElement):
    type: Optional[Literal["standard", "satellite", "blank"]] = None
    iconSvg: Optional[str] = None


class StyleSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    BaseMap: List[BaseMapStyle] = Field(default_factory=list)
    Point: List[StyleElement] = Field(default_factory=list)
    Area: List[StyleElement] = Field(default_factory=list)
    Route: List[StyleElement] = Field(default_factory=list)
    Label: List[StyleElement] = Field(default_factory=list)
    Card: List[StyleElement] = Field(default_factory=list)
    Edge: List[StyleElement] = Field(default_factory=list)
    Global: List[StyleElement] = Field(default_factory=list)

    @field_validator(*VISUAL_CATEGORIES, mode="before")
    @classmethod
    def ensure_category_lists(cls, value: Any) -> Any:
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError("style categories must be arrays")
        return value

