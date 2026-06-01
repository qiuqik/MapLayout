from typing import Any, Dict, List, Type

from pydantic import BaseModel, ValidationError

from ..schemas.geo_schema import GeoFeatureCollection
from ..schemas.style_schema import StyleSpec
from ..schemas.visual_schema import VisualStructure


def _format_errors(exc: ValidationError) -> List[str]:
    return [
        f"{'.'.join(str(part) for part in error.get('loc', []))}: {error.get('msg')}"
        for error in exc.errors()
    ]


def _validate(model: Type[BaseModel], data: Dict[str, Any]) -> Dict[str, Any]:
    try:
        parsed = model.model_validate(data)
    except ValidationError as exc:
        return {
            "valid": False,
            "errors": _format_errors(exc),
            "warnings": [],
        }
    return {
        "valid": True,
        "errors": [],
        "warnings": [],
        "parsed": parsed,
    }


def validate_visual_structure(data: Dict[str, Any]) -> Dict[str, Any]:
    result = _validate(VisualStructure, data)
    parsed = result.pop("parsed", None)
    if parsed is not None and not parsed.Stylesheet.layers:
        result["warnings"].append("visual structure Stylesheet contains no layer mappings")
    return result


def validate_geojson(data: Dict[str, Any]) -> Dict[str, Any]:
    return _validate(GeoFeatureCollection, data)


def validate_style_spec(data: Dict[str, Any]) -> Dict[str, Any]:
    return _validate(StyleSpec, data)
