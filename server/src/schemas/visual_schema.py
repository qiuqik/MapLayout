from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator


VISUAL_CATEGORIES = [
    "BaseMap",
    "Point",
    "Area",
    "Route",
    "Label",
    "Card",
    "Edge",
    "Global",
]


class VisualElement(BaseModel):
    model_config = ConfigDict(extra="allow")

    visual_id: Optional[str] = None
    description: Optional[str] = None
    anchored_to: Optional[Union[str, List[str]]] = None
    anchored_from: Optional[Union[str, List[str]]] = None


class BaseMapVisual(VisualElement):
    type: Optional[Literal["standard", "satellite", "blank"]] = None


class VisualStructure(BaseModel):
    model_config = ConfigDict(extra="allow")

    BaseMap: List[BaseMapVisual] = Field(default_factory=list)
    Point: List[VisualElement] = Field(default_factory=list)
    Area: List[VisualElement] = Field(default_factory=list)
    Route: List[VisualElement] = Field(default_factory=list)
    Label: List[VisualElement] = Field(default_factory=list)
    Card: List[VisualElement] = Field(default_factory=list)
    Edge: List[VisualElement] = Field(default_factory=list)
    Global: List[VisualElement] = Field(default_factory=list)

    @field_validator(*VISUAL_CATEGORIES, mode="before")
    @classmethod
    def ensure_category_lists(cls, value: Any) -> Any:
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError("visual categories must be arrays")
        return value

    def visual_ids(self) -> List[str]:
        ids: List[str] = []
        for category in VISUAL_CATEGORIES:
            for item in getattr(self, category):
                if item.visual_id:
                    ids.append(item.visual_id)
        return ids

