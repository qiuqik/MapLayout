from typing import Any, Dict, List, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ColorToken(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str = ""
    hex: str = ""
    usage: str = ""
    weight: float | int | str = ""


class ColorAnalysis(BaseModel):
    model_config = ConfigDict(extra="allow")

    palette: List[ColorToken] = Field(default_factory=list)
    background: str = ""
    water: str = ""
    road: str = ""
    text: Dict[str, str] = Field(default_factory=dict)
    accent: Dict[str, str] | List[str] | str = Field(default_factory=dict)


class ThemeDesignAnalysis(BaseModel):
    model_config = ConfigDict(extra="allow")

    global_mode: Literal["light", "dark"] = Field(default="light", alias="global")
    theme: str = ""
    design_keywords: List[str] = Field(default_factory=list)
    visual_language: str = ""
    label_design: str = ""
    route_design: str = ""
    icon_design: str = ""


class StylesheetLayer(BaseModel):
    model_config = ConfigDict(extra="allow")

    target: str = ""
    paint: Dict[str, Any] = Field(default_factory=dict)
    layout: Dict[str, Any] = Field(default_factory=dict)


class MapStylesheet(BaseModel):
    model_config = ConfigDict(extra="allow")

    global_mode: Literal["light", "dark"] = Field(default="light", alias="global")
    mapboxStyle: str = "mapbox://styles/mapbox/light-v11"
    layers: List[StylesheetLayer] = Field(default_factory=list)


class VisualStructure(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    Color: ColorAnalysis = Field(default_factory=ColorAnalysis)
    ThemeDesign: ThemeDesignAnalysis = Field(default_factory=ThemeDesignAnalysis, alias="Theme&Design")
    Stylesheet: MapStylesheet = Field(default_factory=MapStylesheet)

    @field_validator("Color", "ThemeDesign", "Stylesheet", mode="before")
    @classmethod
    def ensure_objects(cls, value: Any) -> Any:
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise ValueError("visual structure sections must be objects")
        return value
