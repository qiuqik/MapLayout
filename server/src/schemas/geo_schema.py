from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _contains_empty_or_null(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, list):
        if len(value) == 0:
            return True
        return any(_contains_empty_or_null(item) for item in value)
    return False


class Geometry(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: Literal["Point", "LineString", "Polygon"]
    coordinates: Any

    @field_validator("coordinates")
    @classmethod
    def coordinates_must_not_be_empty(cls, value: Any) -> Any:
        if _contains_empty_or_null(value):
            raise ValueError("coordinates must not contain null or empty arrays")
        return value


class Feature(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: Literal["Feature"]
    geometry: Geometry
    properties: Dict[str, Any] = Field(default_factory=dict)


class GlobalProperty(BaseModel):
    model_config = ConfigDict(extra="allow")

    title: Optional[str] = None
    description: Optional[str] = None
    visual_id: Optional[str] = None


class GeoFeatureCollection(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: Literal["FeatureCollection"]
    features: List[Feature] = Field(default_factory=list)
    global_properties: List[GlobalProperty] = Field(default_factory=list)

    @field_validator("features")
    @classmethod
    def features_must_not_be_empty(cls, value: List[Feature]) -> List[Feature]:
        if not value:
            raise ValueError("features must not be empty")
        return value

