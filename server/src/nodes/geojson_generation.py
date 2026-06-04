import os
import re
import time
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from ..utils.agent_utils import AgentState, _escape_prompt_braces, _extract_first_json_object, _robust_json_loads
from ..utils.prompt_loader import load_prompt
from ..validators.schema_validators import validate_geojson

from ..amap_service import AMapService
import math

CITY_BOUNDS = {
    "新加坡": (103.55, 1.15, 104.15, 1.50),
    "singapore": (103.55, 1.15, 104.15, 1.50),
}

SINGAPORE_REQUESTED_POIS = [
    {"name": "福康宁公园", "aliases": ["福康宁公园", "Fort Canning"], "coordinates": [103.8465, 1.2950], "category": "nature", "day": 1},
    {"name": "鱼尾狮公园", "aliases": ["鱼尾狮公园", "鱼尾狮", "Merlion"], "coordinates": [103.8545, 1.2868], "category": "scenic", "day": 1},
    {"name": "克拉码头", "aliases": ["克拉码头", "Clarke Quay"], "coordinates": [103.8465, 1.2906], "category": "food", "day": 1},
    {"name": "新加坡环球影城", "aliases": ["新加坡环球影城", "环球影城", "Universal Studios"], "coordinates": [103.8238, 1.2540], "category": "entertainment", "day": 2},
    {"name": "S.E.A.海洋馆", "aliases": ["S.E.A.海洋馆", "S.E.A. Aquarium", "SEA Aquarium"], "coordinates": [103.8203, 1.2588], "category": "entertainment", "day": 2},
    {"name": "西乐索海滩", "aliases": ["西乐索海滩", "Siloso Beach"], "coordinates": [103.8129, 1.2536], "category": "nature", "day": 2},
    {"name": "唐人街", "aliases": ["唐人街", "Chinatown"], "coordinates": [103.8439, 1.2836], "category": "culture", "day": 3},
    {"name": "小印度", "aliases": ["小印度", "Little India"], "coordinates": [103.8520, 1.3067], "category": "culture", "day": 3},
    {"name": "哈芝巷", "aliases": ["哈芝巷", "Haji Lane"], "coordinates": [103.8593, 1.3007], "category": "culture", "day": 3},
]

SINGAPORE_KNOWN_POIS = [
    *SINGAPORE_REQUESTED_POIS,
    {"name": "滨海湾金沙空中花园", "aliases": ["滨海湾金沙空中花园", "金沙空中花园", "Marina Bay Sands SkyPark", "SkyPark"], "coordinates": [103.8607, 1.2839], "category": "scenic", "day": 1},
    {"name": "滨海湾花园", "aliases": ["滨海湾花园", "Gardens by the Bay"], "coordinates": [103.8649, 1.2816], "category": "nature", "day": 1},
    {"name": "苏丹回教堂", "aliases": ["苏丹回教堂", "苏丹清真寺", "Sultan Mosque"], "coordinates": [103.8590, 1.3023], "category": "culture", "day": 3},
    {"name": "新加坡国家博物馆", "aliases": ["新加坡国家博物馆", "National Museum of Singapore"], "coordinates": [103.8488, 1.2966], "category": "culture", "day": 3},
    {"name": "西乐索炮台空中步道", "aliases": ["西乐索炮台空中步道", "Fort Siloso Skywalk"], "coordinates": [103.8108, 1.2574], "category": "scenic", "day": 2},
]

class GeoJSONGenerationNode:
    """Node 3: 数据结构化与拓扑映射 (Model: GPT-5/o1)
    
    输入: 节点 1 的意图丰富结果 + 节点 2 的视觉结构
    逻辑: 将用户的旅行规划提取为标准的 GeoJSON 格式，并将规划中的元素与 visual.json 中的视觉分类 `visual_id` 一一对应
    输出: 标准的 GeoJSON FeatureCollection
    """

    PROMPT_NAME = "geojson_generation"
    PROMPT_VERSION = "v0.4"
    
    def __init__(self, llm: ChatOpenAI, amap_service: AMapService = None):
        self.llm = llm
        self.amap_service = amap_service or AMapService()
        try:
            self.max_pois_per_day = max(2, int(os.getenv("MAX_POIS_PER_DAY", "5")))
        except ValueError:
            self.max_pois_per_day = 5
        
        geojson_example = '''{
  "_mapping_thought": "我从 Node 1 中识别出 2 天行程，因此按 D1/D2 生成两条 LineString；每个 POI 都是具体地点；D1 起点和 D2 关键点为 core，其余为 secondary 或 detail。",
  "_city":"北京",
  "type": "FeatureCollection",
  "global_properties": [
    {
      "visual_id": "global_title",
      "title": "2 天 1 夜北京核心景点游",
      "script": "中轴线历史漫步 + 长城轻量远足",
      "extra_info": "D1：天安门广场→故宫博物院→景山公园；D2：八达岭长城→奥林匹克公园"
    },
    {
      "visual_id": "global_summary",
      "title": "路线节奏",
      "script": "D1 以步行为主，D2 早出发串联远郊与返程前城市地标"
    }
  ],
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [116.397, 39.908],
          [116.397, 39.916],
          [116.395, 39.923]
        ]
      },
      "properties": {
        "visual_id": "route_D1",
        "name": "D1 路线",
        "day": "D1",
        "point_names": ["天安门广场", "故宫博物院", "景山公园"]
      }
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [116.416, 40.359],
          [116.391, 39.992]
        ]
      },
      "properties": {
        "visual_id": "route_D2",
        "name": "D2 路线",
        "day": "D2",
        "point_names": ["八达岭长城", "奥林匹克公园"]
      }
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [116.397, 39.908]
      },
      "properties": {
        "visual_id": "point_scenic",
        "category": "scenic",
        "name": "天安门广场",
        "day": "D1",
        "order": 1,
        "label_level": "core",
        "label_title": "天安门广场",
        "label_script": "D1 起点，建议清晨抵达",
        "label_extra_info": ""
      }
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [116.397, 39.916]
      },
      "properties": {
        "visual_id": "point_culture",
        "category": "culture",
        "name": "故宫博物院",
        "day": "D1",
        "order": 2,
        "label_level": "detail",
        "label_title": "故宫博物院",
        "label_script": "步行进入，预留 3-4 小时",
        "label_extra_info": "提前预约"
      }
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [116.395, 39.923]
      },
      "properties": {
        "visual_id": "point_scenic",
        "category": "scenic",
        "name": "景山公园",
        "day": "D1",
        "order": 3,
        "label_level": "secondary",
        "label_title": "景山公园",
        "label_script": "俯瞰故宫和中轴线",
        "label_extra_info": ""
      }
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [116.416, 40.359]
      },
      "properties": {
        "visual_id": "point_scenic",
        "category": "scenic",
        "name": "八达岭长城",
        "day": "D2",
        "order": 1,
        "label_level": "core",
        "label_title": "八达岭长城",
        "label_script": "D2 早出发，高铁/市郊铁路衔接",
        "label_extra_info": ""
      }
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [116.391, 39.992]
      },
      "properties": {
        "visual_id": "point_culture",
        "category": "culture",
        "name": "奥林匹克公园",
        "day": "D2",
        "order": 2,
        "label_level": "secondary",
        "label_title": "奥林匹克公园",
        "label_script": "返程前轻量游览",
        "label_extra_info": ""
      }
    }
  ]
}'''

        raw_system_prompt = load_prompt("geojson_generation.md").replace("{geojson_example}", geojson_example)
        system_prompt = _escape_prompt_braces(raw_system_prompt)
        
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            ("human", "用户旅行规划：\n{intent_enriched}\n\n视觉元素字典：\n{visual_structure}\n\n{feedback_section}请生成 GeoJSON 数据：")
        ])
        
        self.chain = self.prompt | self.llm
    

    
    def _correct_and_sync_topology(self, geojson_data: dict) -> dict:
        """核心逻辑：基于原始坐标映射，同步更新所有几何图形"""
        features = geojson_data.get("features", [])
        city = geojson_data.get("_city", "")
        bounds = self._city_bounds(city)
        
        # 1. 建立全局坐标真值表
        # 格式: { (原始经度, 原始纬度): [修正后经度, 修正后纬度] }
        coord_map = {}
        valid_points = []
        
        print("   🔍 开始修正 Point 坐标并建立映射表...")
        for feat in features:
            if feat.get("geometry", {}).get("type") == "Point":
                old_coords = tuple(feat["geometry"]["coordinates"])
                name = feat.get("properties", {}).get("name", "")
                
                # 避免对同一原始坐标重复请求 API
                if old_coords not in coord_map:
                    location_str = f"{old_coords[0]},{old_coords[1]}"
                    known_coords = self._lookup_known_destination_poi(name, city)
                    if known_coords:
                        new_coords = known_coords
                    elif bounds and self._within_bounds(old_coords, bounds):
                        new_coords = old_coords
                        print(f"      ↪️ [{name}] 已在 {city} 范围内，保留模型/QA坐标，避免 geocoder 覆盖")
                    else:
                        new_coords = self.amap_service.search_poi(name, city=city, location=location_str)
                    
                    if new_coords:
                        coord_map[old_coords] = list(new_coords)
                        print(f"      ✅ [{name}] 坐标已更新")
                    else:
                        print(f"      ⚠️ [{name}] 未找到坐标，将被剔除")
                        continue # 找不到就不加入映射表，并在后续丢弃该点
                
                if old_coords in coord_map:
                    feat["geometry"]["coordinates"] = coord_map[old_coords]
                    valid_points.append(feat)

        # 2. 同步更新 LineString
        valid_lines = []
        for feat in features:
            if feat.get("geometry", {}).get("type") == "LineString":
                old_line_coords = feat["geometry"]["coordinates"]
                new_line_coords = []
                
                for pt in old_line_coords:
                    t_pt = tuple(pt)
                    # 如果线中的原始点在映射表中，替换为修正后的点
                    if t_pt in coord_map:
                        new_line_coords.append(coord_map[t_pt])
                    else:
                        # 对于未被识别为 POI 的路径点，保留原样
                        new_line_coords.append(pt)
                
                if len(new_line_coords) >= 2:
                    feat["geometry"]["coordinates"] = new_line_coords
                    valid_lines.append(feat)

        # 3. 当前产品形态只保留具体 POI 和按天路线，避免非具体地点混入 POI 层。
        geojson_data["features"] = valid_points + valid_lines
        return geojson_data

    def _city_bounds(self, city: str):
        city_text = str(city or "").lower()
        for key, bounds in CITY_BOUNDS.items():
            if key.lower() in city_text:
                return bounds
        return None

    def _within_bounds(self, coords, bounds) -> bool:
        if not coords or not bounds or len(coords) < 2:
            return False
        lon, lat = coords[0], coords[1]
        west, south, east, north = bounds
        return west <= lon <= east and south <= lat <= north

    def _infer_trip_days(self, text: str, geojson_data: dict) -> int:
        chinese_digits = {
            "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5,
            "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
        }
        match = re.search(r"(\d+)\s*(?:天|日|day|days)", text or "", re.IGNORECASE)
        if match:
            return max(1, int(match.group(1)))
        match = re.search(r"([一二两三四五六七八九十])\s*(?:天|日)", text or "")
        if match:
            return chinese_digits.get(match.group(1), 1)
        days = [
            self._normalize_day((feature.get("properties") or {}).get("day"), fallback=1)
            for feature in geojson_data.get("features", [])
        ]
        return max(days) if days else 1

    def _alias_in_text(self, text: str, aliases: list[str]) -> bool:
        normalized_text = self._normalize_poi_name(text)
        return any(
            bool(self._normalize_poi_name(alias)) and self._normalize_poi_name(alias) in normalized_text
            for alias in aliases
        )

    def _lookup_known_destination_poi(self, name: str, city: str):
        city_text = str(city or "").lower()
        if "新加坡" not in city_text and "singapore" not in city_text:
            return None
        for poi in SINGAPORE_KNOWN_POIS:
            if self._alias_in_text(name, poi["aliases"]):
                return tuple(poi["coordinates"])
        return None

    def _macro_area(self, name: str) -> str:
        normalized = self._normalize_poi_name(name)
        for area in ["滨海湾", "圣淘沙", "小印度", "唐人街", "克拉码头"]:
            if self._normalize_poi_name(area) in normalized:
                return area
        return ""

    def _remove_non_requested_area_duplicates(self, geojson_data: dict, user_text: str) -> dict:
        features = geojson_data.get("features", [])
        points = [feature for feature in features if feature.get("geometry", {}).get("type") == "Point"]
        removed_ids = set()

        def is_requested(feature: dict) -> bool:
            name = (feature.get("properties") or {}).get("name", "")
            return self._alias_in_text(user_text, [name])

        for index, first in enumerate(points):
            if id(first) in removed_ids:
                continue
            first_props = first.get("properties") or {}
            first_area = self._macro_area(first_props.get("name", ""))
            if not first_area:
                continue
            for second in points[index + 1:]:
                if id(second) in removed_ids:
                    continue
                second_props = second.get("properties") or {}
                if first_props.get("day") != second_props.get("day"):
                    continue
                if first_area != self._macro_area(second_props.get("name", "")):
                    continue
                dist = self._distance_meters(
                    first.get("geometry", {}).get("coordinates"),
                    second.get("geometry", {}).get("coordinates"),
                )
                if dist >= 750:
                    continue
                first_requested = is_requested(first)
                second_requested = is_requested(second)
                if first_requested and second_requested:
                    continue
                remove_feature = first if second_requested else second
                removed_ids.add(id(remove_feature))
                print(
                    f"      ↪️ 移除同区域过密 POI: {(remove_feature.get('properties') or {}).get('name', '')}"
                )

        if removed_ids:
            geojson_data["features"] = [
                feature for feature in features
                if feature.get("geometry", {}).get("type") != "Point" or id(feature) not in removed_ids
            ]
        return geojson_data

    def _ensure_requested_known_pois(self, geojson_data: dict, user_text: str) -> dict:
        city = str(geojson_data.get("_city") or "")
        if "新加坡" not in city and "singapore" not in city.lower():
            return geojson_data
        features = geojson_data.setdefault("features", [])
        point_features = [feature for feature in features if feature.get("geometry", {}).get("type") == "Point"]
        trip_days = self._infer_trip_days(user_text, geojson_data)
        day_counts: dict[int, int] = {}
        for feature in point_features:
            props = feature.get("properties") or {}
            day = self._normalize_day(props.get("day"), fallback=1)
            day_counts[day] = day_counts.get(day, 0) + 1

        for poi in SINGAPORE_REQUESTED_POIS:
            if not self._alias_in_text(user_text, poi["aliases"]):
                continue
            requested_name = poi["name"]
            requested_coord = poi["coordinates"]
            if any(self._alias_in_text(feature.get("properties", {}).get("name", ""), poi["aliases"]) for feature in point_features):
                continue

            nearby = None
            for feature in point_features:
                props = feature.get("properties") or {}
                if self._alias_in_text(user_text, [props.get("name", "")]):
                    continue
                dist = self._distance_meters(requested_coord, feature.get("geometry", {}).get("coordinates"))
                if dist < 220:
                    nearby = feature
                    break

            if nearby:
                props = nearby.setdefault("properties", {})
                props["name"] = requested_name
                props["label_title"] = requested_name
                props["category"] = poi["category"]
                props["visual_id"] = f"point_{poi['category']}"
                nearby.setdefault("geometry", {})["coordinates"] = list(requested_coord)
                props["label_coord"] = list(requested_coord)
                continue

            preferred_day = min(max(1, int(poi["day"])), trip_days)
            day = preferred_day if day_counts.get(preferred_day, 0) < self.max_pois_per_day else min(
                range(1, trip_days + 1),
                key=lambda candidate_day: day_counts.get(candidate_day, 0),
            )
            day_counts[day] = day_counts.get(day, 0) + 1
            order = day_counts[day]
            feature = {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": list(requested_coord)},
                "properties": {
                    "visual_id": f"point_{poi['category']}",
                    "category": poi["category"],
                    "name": requested_name,
                    "day": f"D{day}",
                    "order": order,
                    "label_level": "secondary" if order > 1 else "core",
                    "label_title": requested_name,
                    "label_script": "用户明确指定的行程地点",
                    "label_extra_info": "",
                    "label_coord": list(requested_coord),
                },
            }
            features.append(feature)
            point_features.append(feature)

        return geojson_data

    def _enforce_city_bounds(self, geojson_data: dict) -> dict:
        """Known destination guard: reject or re-geocode points outside the destination envelope."""
        city = geojson_data.get("_city", "")
        bounds = self._city_bounds(city)
        if not bounds:
            return geojson_data

        kept_points = []
        for feature in geojson_data.get("features", []):
            if feature.get("geometry", {}).get("type") != "Point":
                continue
            props = feature.get("properties", {})
            coords = feature.get("geometry", {}).get("coordinates")
            name = props.get("name", "")
            if self._within_bounds(coords, bounds):
                kept_points.append(feature)
                continue
            corrected = self.amap_service.search_poi(name, city=city)
            if corrected and self._within_bounds(corrected, bounds):
                feature["geometry"]["coordinates"] = list(corrected)
                feature["properties"]["label_coord"] = feature["properties"].get("label_coord") or list(corrected)
                kept_points.append(feature)
                print(f"      ✅ [{name}] 城市范围外坐标已重定位到 {city}")
            else:
                print(f"      ⚠️ [{name}] 超出 {city} 范围且无法重定位，将被剔除")

        geojson_data["features"] = kept_points
        return self._normalize_travel_semantics(geojson_data, {})

    def _normalize_day(self, value, fallback: int = 1) -> int:
        if isinstance(value, int):
            return max(1, value)
        text = str(value or "")
        match = re.search(r"(?:D|DAY|第)?\s*(\d+)", text, re.IGNORECASE)
        return max(1, int(match.group(1))) if match else fallback

    def _normalize_order(self, value, fallback: int = 999) -> int:
        if isinstance(value, int):
            return max(1, value)
        match = re.search(r"\d+", str(value or ""))
        return max(1, int(match.group(0))) if match else fallback

    def _normalize_poi_name(self, name: str) -> str:
        normalized = re.sub(r"[\s·•\-_/()（）【】\[\]，,。.:：;；'\"“”]", "", str(name or "").lower())
        for suffix in ["游客中心", "地铁站", "公交站", "站"]:
            if len(normalized) > len(suffix) + 1 and normalized.endswith(suffix):
                normalized = normalized[: -len(suffix)]
        return normalized

    def _is_non_poi_place(self, feature: dict) -> bool:
        props = feature.get("properties") or {}
        name = str(props.get("name") or props.get("label_title") or "")
        if name.endswith(("片区", "商圈", "街道", "区域", "范围", "新区", "城区")):
            return True
        if self._normalize_poi_name(name) in {"圣淘沙", "sentosa"}:
            return True
        if len(name) <= 4 and name.endswith(("区", "市", "县")):
            return True
        return False

    def _distance_meters(self, coord_a, coord_b) -> float:
        try:
            lon1, lat1 = float(coord_a[0]), float(coord_a[1])
            lon2, lat2 = float(coord_b[0]), float(coord_b[1])
        except (TypeError, ValueError, IndexError):
            return float("inf")
        radius = 6371000
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        d_phi = math.radians(lat2 - lat1)
        d_lambda = math.radians(lon2 - lon1)
        a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
        return 2 * radius * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    def _is_duplicate_poi(self, candidate: dict, kept: list[dict]) -> bool:
        candidate_props = candidate.get("properties") or {}
        candidate_name = self._normalize_poi_name(candidate_props.get("name"))
        candidate_day = candidate_props.get("day")
        candidate_coord = candidate.get("geometry", {}).get("coordinates")
        for existing in kept:
            existing_props = existing.get("properties") or {}
            existing_name = self._normalize_poi_name(existing_props.get("name"))
            if candidate_name and existing_name:
                if candidate_name == existing_name:
                    return True
                if min(len(candidate_name), len(existing_name)) >= 2 and (
                    candidate_name in existing_name or existing_name in candidate_name
                ):
                    return True
            dist = self._distance_meters(candidate_coord, existing.get("geometry", {}).get("coordinates"))
            if dist < 35:
                return True
            if candidate_day == existing_props.get("day") and dist < 120:
                return True
        return False

    def _normalize_category(self, props: dict, fallback: str = "poi") -> str:
        raw = props.get("category") or props.get("poi_category") or props.get("type") or props.get("visual_id") or fallback
        aliases = {
            "景点": "scenic",
            "自然景观": "scenic",
            "文化": "culture",
            "文化历史": "culture",
            "博物馆": "culture",
            "餐饮": "food",
            "美食": "food",
            "酒店": "hotel",
            "住宿": "hotel",
            "交通": "transport",
            "购物": "shopping",
            "娱乐": "entertainment",
            "滑雪": "ski",
        }
        text = str(raw or fallback).strip()
        text = aliases.get(text, text)
        if text.startswith("point_"):
            text = text[6:]
        text = re.sub(r"[^a-zA-Z0-9_]+", "_", text.lower())
        text = re.sub(r"_+", "_", text).strip("_")
        return text or fallback

    def _normalize_label_content_type(self, value: str | None, hierarchy: str, props: dict) -> str:
        aliases = {
            "只包含title": "title",
            "只包含 title": "title",
            "title": "title",
            "包含title+script": "title_script",
            "包含 title+script": "title_script",
            "title+script": "title_script",
            "title_script": "title_script",
            "title+script+extra info": "title_script_extra",
            "title_script_extra": "title_script_extra",
        }
        normalized = aliases.get(str(value or "").strip())
        if normalized:
            return normalized
        if hierarchy == "detail":
            return "title_script_extra"
        if props.get("label_extra_info") or props.get("extra_info"):
            return "title_script_extra"
        return "title_script" if props.get("label_script") or props.get("description") else "title"

    def _normalize_label_hierarchy(self, value: str | None, order_index: int) -> str:
        aliases = {
            "核心标签": "core",
            "core": "core",
            "次要标签": "secondary",
            "secondary": "secondary",
            "详细标签": "detail",
            "detail": "detail",
        }
        normalized = aliases.get(str(value or "").strip())
        if normalized:
            return normalized
        if order_index == 0:
            return "core"
        if order_index <= 2:
            return "secondary"
        return "detail"

    def _normalize_global_properties(self, geojson_data: dict) -> None:
        source_items = geojson_data.get("global_properties")
        if not isinstance(source_items, list):
            source_items = []

        normalized = []
        for index, source in enumerate(source_items[:2]):
            if not isinstance(source, dict):
                continue
            if index == 0:
                item = {
                    "visual_id": source.get("visual_id") or "global_title",
                    "title": source.get("title") or source.get("name") or "旅行路线规划",
                    "script": source.get("script") or source.get("description") or source.get("subtitle") or "",
                    "extra_info": source.get("extra_info") or source.get("summary") or source.get("detail") or "",
                }
            else:
                item = {
                    "visual_id": source.get("visual_id") or "global_summary",
                    "title": source.get("title") or source.get("name") or "路线节奏",
                    "script": source.get("script") or source.get("description") or source.get("subtitle") or "",
                }
            normalized.append(item)

        if not normalized:
            city = geojson_data.get("_city") or ""
            normalized.append(
                {
                    "visual_id": "global_title",
                    "title": f"{city}旅行路线规划" if city else "旅行路线规划",
                    "script": "按天数拆分路线与重点 POI",
                    "extra_info": "",
                }
            )

        geojson_data["global_properties"] = normalized[:2]

    def _normalize_travel_semantics(self, geojson_data: dict, visual_structure: dict | None = None) -> dict:
        """Deduplicate concrete POIs, classify labels, and rebuild one route per day."""
        features = geojson_data.get("features", [])

        existing_routes_by_day = {}
        route_order = []
        for feature in features:
            if feature.get("geometry", {}).get("type") != "LineString":
                continue
            props = feature.get("properties") or {}
            day_num = self._normalize_day(props.get("day") or props.get("name") or props.get("description"), fallback=len(route_order) + 1)
            existing_routes_by_day.setdefault(day_num, props)
            if day_num not in route_order:
                route_order.append(day_num)

        candidates = []
        day_counts: dict[int, int] = {}
        for feature in features:
            if feature.get("geometry", {}).get("type") != "Point":
                continue
            if self._is_non_poi_place(feature):
                continue
            props = feature.setdefault("properties", {})
            day_num = self._normalize_day(props.get("day") or props.get("day_index") or props.get("name") or props.get("description"), fallback=1)
            props["day"] = f"D{day_num}"
            day_counts[day_num] = day_counts.get(day_num, 0) + 1
            props["order"] = self._normalize_order(props.get("order") or props.get("sequence"), fallback=day_counts[day_num])
            category = self._normalize_category(props)
            props["category"] = category
            props["visual_id"] = f"point_{category}"
            if not props.get("name"):
                props["name"] = props.get("label_title") or f"D{day_num} POI {props['order']}"
            candidates.append(feature)

        candidates.sort(key=lambda feat: (
            self._normalize_day(feat.get("properties", {}).get("day")),
            self._normalize_order(feat.get("properties", {}).get("order")),
            str(feat.get("properties", {}).get("name") or ""),
        ))

        deduped = []
        for feature in candidates:
            if self._is_duplicate_poi(feature, deduped):
                continue
            deduped.append(feature)

        points_by_day: dict[int, list[dict]] = {}
        for feature in deduped:
            day_num = self._normalize_day(feature.get("properties", {}).get("day"))
            points_by_day.setdefault(day_num, []).append(feature)

        kept_points = []
        max_pois_per_day = max(2, int(getattr(self, "max_pois_per_day", 5)))
        for day_num in sorted(points_by_day):
            day_points = sorted(
                points_by_day[day_num],
                key=lambda feat: self._normalize_order(feat.get("properties", {}).get("order")),
            )[:max_pois_per_day]
            for index, feature in enumerate(day_points):
                props = feature.setdefault("properties", {})
                coords = feature.get("geometry", {}).get("coordinates")
                hierarchy = self._normalize_label_hierarchy(props.get("label_level") or props.get("label_hierarchy") or props.get("hierarchy"), index)
                content_type = self._normalize_label_content_type(props.get("label_content_type") or props.get("content_type"), hierarchy, props)
                props["day"] = f"D{day_num}"
                props["order"] = index + 1
                props["label_level"] = hierarchy
                props["label_content_type"] = content_type
                props["label_title"] = props.get("label_title") or props.get("name") or ""
                if not props.get("label_script"):
                    props["label_script"] = str(props.get("description") or "")[:36]
                if "label_extra_info" not in props:
                    props["label_extra_info"] = props.get("open_time") or props.get("ticket") or props.get("transport") or ""
                props["label_coord"] = props.get("label_coord") or coords
                props.pop("label_hierarchy", None)
                for noisy_key in ["global_title", "global_description", "trip_summary", "total_budget", "summary_title", "trip_title"]:
                    props.pop(noisy_key, None)
                kept_points.append(feature)

        rebuilt_routes = []
        for route_index, day_num in enumerate(sorted(points_by_day), start=1):
            day_points = [p for p in kept_points if self._normalize_day(p.get("properties", {}).get("day")) == day_num]
            if len(day_points) < 2:
                continue
            existing_props = dict(existing_routes_by_day.get(day_num) or {})
            existing_props["visual_id"] = f"route_D{day_num}"
            existing_props["name"] = existing_props.get("name") or f"D{day_num} 路线"
            existing_props["day"] = f"D{day_num}"
            existing_props["point_names"] = [p.get("properties", {}).get("name", "") for p in day_points]
            existing_props["description"] = "→".join(existing_props["point_names"])
            rebuilt_routes.append({
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [p.get("geometry", {}).get("coordinates") for p in day_points],
                },
                "properties": existing_props,
            })

        self._normalize_global_properties(geojson_data)
        geojson_data["features"] = rebuilt_routes + kept_points
        return geojson_data

    def _annotate_feature_metadata(self, geojson_data: dict) -> dict:
        """Add stable feature ids and machine-readable visual-to-content mappings."""
        features = geojson_data.get("features", [])
        counters = {"Point": 0, "LineString": 0}
        prefixes = {"Point": "poi", "LineString": "route"}
        used_feature_ids = set()
        visual_mapping = {}

        for feature in features:
            geometry = feature.get("geometry") or {}
            properties = feature.setdefault("properties", {})
            geom_type = geometry.get("type", "Feature")

            if not properties.get("feature_id"):
                counters[geom_type] = counters.get(geom_type, 0) + 1
                prefix = prefixes.get(geom_type, "feature")
                candidate = f"{prefix}_{counters[geom_type]:03d}"
                while candidate in used_feature_ids:
                    counters[geom_type] += 1
                    candidate = f"{prefix}_{counters[geom_type]:03d}"
                properties["feature_id"] = candidate
            used_feature_ids.add(properties["feature_id"])

            if not properties.get("semantic_role"):
                properties["semantic_role"] = {
                    "Point": "poi",
                    "LineString": "route",
                }.get(geom_type, "feature")

            visual_id = properties.get("visual_id")
            if visual_id:
                item = visual_mapping.setdefault(
                    visual_id,
                    {
                        "visual_id": visual_id,
                        "applied_to": [],
                        "properties": [],
                    }
                )
                item["applied_to"].append(properties["feature_id"])
                if "visual_id" not in item["properties"]:
                    item["properties"].append("visual_id")

        geojson_data["_visual_content_mapping"] = list(visual_mapping.values())
        return geojson_data

    def execute(self, state: AgentState, max_retries: int = 3) -> AgentState:
        print("📍 [Node 3] 数据结构化与拓扑映射: 正在生成 GeoJSON 数据...")
        
        if not state.intent_enriched:
            state.error = "缺少增强后的意图描述"
            print(f"❌ [Node 3] 缺少意图描述")
            return state
        
        if not state.visual_structure:
            state.error = "缺少视觉结构解析结果"
            print(f"❌ [Node 3] 缺少视觉结构")
            return state
        
        retry_count = 0
        
        while retry_count < max_retries:
            try:
                import json
                visual_structure_str = json.dumps(state.visual_structure, ensure_ascii=False)

                # 如果有上轮验证反馈，将其拼入 prompt 中
                if state.validation_feedback and state.geojson_data:
                    prev_result_str = json.dumps(state.geojson_data, ensure_ascii=False)[:2000]
                    feedback_section = (
                        f"【上次生成的结果（存在问题，请修正后重新生成）】:\n{prev_result_str}\n\n"
                        f"【QA 反馈意见（必须修正以下所有问题）】:\n{state.validation_feedback}\n\n"
                    )
                else:
                    feedback_section = ""

                response = self.chain.invoke({
                    "intent_enriched": state.intent_enriched,
                    "visual_structure": visual_structure_str,
                    "feedback_section": feedback_section
                })
                content = response.content
                
                json_str = _extract_first_json_object(content)
                geojson_data = _robust_json_loads(json_str)
                if not geojson_data.get("global_properties"):
                    geojson_data["global_properties"] = [
                        {
                            "visual_id": "global_title",
                            "title": state.global_title or "旅行路线规划",
                            "script": state.global_description or "",
                            "extra_info": "",
                        }
                    ]
                geojson_data = self._correct_and_sync_topology(geojson_data)
                geojson_data = self._ensure_requested_known_pois(geojson_data, state.user_text)
                geojson_data = self._remove_non_requested_area_duplicates(geojson_data, state.user_text)
                geojson_data = self._normalize_travel_semantics(geojson_data, state.visual_structure)
                geojson_data = self._enforce_city_bounds(geojson_data)
                geojson_data = self._annotate_feature_metadata(geojson_data)

                schema_report = validate_geojson(geojson_data)
                if schema_report["valid"]:
                    print("✅ [Node 3] GeoJSON schema 校验通过")
                else:
                    print(f"⚠️ [Node 3] GeoJSON schema 校验失败: {schema_report['errors']}")
                
                state.geojson_data = geojson_data
                print(f"✅ [Node 3] GeoJSON 生成与拓扑修正完成，共 {len(geojson_data['features'])} 个 Feature")
                return state
                    
            except Exception as e:
                retry_count += 1
                state.retry_count = retry_count
                print(f"⚠️ [Node 3] 第 {retry_count} 次尝试失败: {e}")
                
                if retry_count >= max_retries:
                    state.error = f"GeoJSON 生成失败，已重试 {max_retries} 次: {str(e)}"
                    print(f"❌ [Node 3] 重试次数用尽: {e}")
                else:
                    time.sleep(1)
        
        return state
