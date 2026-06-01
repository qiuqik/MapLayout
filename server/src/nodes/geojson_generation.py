import re
import time
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from ..utils.agent_utils import AgentState, _escape_prompt_braces, _extract_first_json_object, _robust_json_loads
from ..utils.prompt_loader import load_prompt
from ..validators.schema_validators import validate_geojson

from ..amap_service import AMapService
import math

class GeoJSONGenerationNode:
    """Node 3: 数据结构化与拓扑映射 (Model: GPT-5/o1)
    
    输入: 节点 1 的意图丰富结果 + 节点 2 的视觉结构
    逻辑: 将用户的旅行规划提取为标准的 GeoJSON 格式，并将规划中的元素与 visual.json 中的视觉分类 `visual_id` 一一对应
    输出: 标准的 GeoJSON FeatureCollection
    """

    PROMPT_NAME = "geojson_generation"
    PROMPT_VERSION = "v0.2"
    
    def __init__(self, llm: ChatOpenAI, amap_service: AMapService = None):
        self.llm = llm
        self.amap_service = amap_service or AMapService()
        
        geojson_example = '''{
  "_mapping_thought": "我从 Node 1 中识别出 2 天行程，因此按 D1/D2 生成两条 LineString；每个 POI 都是具体地点，没有行政区或区域面；文字信息全部通过 Label 字段承载，其中 D1 起点和 D2 关键点为核心标签，其余为次要或详细标签。",
  "_city":"北京",
  "type": "FeatureCollection",
  "global_properties": [
      {
        "title": "2 天 1 夜北京核心景点游",
        "description": "D1：天安门广场→故宫博物院→景山公园；D2：八达岭长城→奥林匹克公园。",
        "visual_id": "global_vis_1"
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
	        "visual_id": "route_vis_1",
	        "name": "D1 北京中轴线步行路线",
	        "day": "D1",
	        "description": "天安门广场→故宫博物院→景山公园"
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
        "visual_id": "route_vis_1",
        "name": "D2 长城与返程路线",
        "day": "D2",
        "description": "八达岭长城→奥林匹克公园"
      }
    },
	    {
	      "type": "Feature",
	      "geometry": {
        "type": "Point",
        "coordinates": [116.397, 39.908]
      },
      "properties": {
	        "visual_id": "point_vis_1",
	        "name": "天安门广场",
	        "day": "D1",
	        "order": 1,
	        "description": "中轴线行程起点",
	        "label_coord": [116.390, 39.809],
	        "label_visual_id": "label_vis_1",
	        "label_content_type": "title_script",
	        "label_hierarchy": "core",
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
	        "visual_id": "point_vis_1",
	        "name": "故宫博物院",
	        "day": "D1",
	        "order": 2,
	        "description": "核心景点，需预约",
	        "label_coord": [116.390, 39.809],
	        "label_visual_id": "label_vis_1",
	        "label_content_type": "title_script_extra",
	        "label_hierarchy": "detail",
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
        "visual_id": "point_vis_1",
        "name": "景山公园",
        "day": "D1",
        "order": 3,
        "description": "俯瞰故宫和中轴线",
        "label_coord": [116.390, 39.809],
        "label_visual_id": "label_vis_1",
        "label_content_type": "title",
        "label_hierarchy": "secondary",
        "label_title": "景山公园",
        "label_script": "",
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
	        "visual_id": "point_vis_1",
	        "name": "八达岭长城",
	        "day": "D2",
	        "order": 1,
	        "description": "D2 核心景点",
	        "label_coord": [116.390, 39.809],
	        "label_visual_id": "label_vis_1",
	        "label_content_type": "title_script",
	        "label_hierarchy": "core",
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
        "visual_id": "point_vis_1",
        "name": "奥林匹克公园",
        "day": "D2",
        "order": 2,
        "description": "返程前轻量游览",
        "label_coord": [116.390, 39.809],
        "label_visual_id": "label_vis_1",
        "label_content_type": "title",
        "label_hierarchy": "secondary",
        "label_title": "奥林匹克公园",
        "label_script": "",
        "label_extra_info": ""
      }
    }
  ]
}'''

        safe_geojson_example = _escape_prompt_braces(geojson_example)
        system_prompt = load_prompt("geojson_generation.md").format(
            geojson_example=safe_geojson_example
        )
        
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            ("human", "用户旅行规划：\n{intent_enriched}\n\n视觉元素字典：\n{visual_structure}\n\n{feedback_section}请生成 GeoJSON 数据：")
        ])
        
        self.chain = self.prompt | self.llm
    

    
    def _correct_and_sync_topology(self, geojson_data: dict) -> dict:
        """核心逻辑：基于原始坐标映射，同步更新所有几何图形"""
        features = geojson_data.get("features", [])
        city = geojson_data.get("_city", "")
        
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

        # 3. 当前产品形态不再生成 Area/Polygon，避免区域信息混入 POI 层。
        geojson_data["features"] = valid_points + valid_lines
        return geojson_data

    def _category_visual_ids(self, visual_structure: dict, category: str) -> list[str]:
        if not isinstance(visual_structure, dict):
            return []
        ids = []
        for item in visual_structure.get(category) or []:
            if isinstance(item, dict) and item.get("visual_id"):
                ids.append(item["visual_id"])
        return ids

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

    def _is_region_like_point(self, feature: dict) -> bool:
        props = feature.get("properties") or {}
        name = str(props.get("name") or props.get("label_title") or "")
        role = str(props.get("semantic_role") or "").lower()
        if role in {"area", "region", "district", "admin_area"}:
            return True
        if name.endswith(("片区", "商圈", "街道", "区域", "范围", "新区", "城区")):
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

    def _label_style_by_hierarchy(self, visual_structure: dict) -> dict[str, str]:
        aliases = {"核心标签": "core", "次要标签": "secondary", "详细标签": "detail"}
        mapping = {}
        labels = (visual_structure or {}).get("Label") or []
        for item in labels:
            if not isinstance(item, dict) or not item.get("visual_id"):
                continue
            hierarchy = aliases.get(str(item.get("hierarchy") or item.get("label_hierarchy") or ""), item.get("hierarchy"))
            if hierarchy in {"core", "secondary", "detail"} and hierarchy not in mapping:
                mapping[hierarchy] = item["visual_id"]
        return mapping

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
        return "title_script" if props.get("description") else "title"

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

    def _normalize_travel_semantics(self, geojson_data: dict, visual_structure: dict | None = None) -> dict:
        """Deduplicate POIs, apply label hierarchy, remove legacy Card/Area, and rebuild day routes."""
        features = geojson_data.get("features", [])
        point_visual_ids = self._category_visual_ids(visual_structure, "Point") or ["point_vis_1"]
        route_visual_ids = self._category_visual_ids(visual_structure, "Route") or ["route_vis_1"]
        label_visual_ids = self._category_visual_ids(visual_structure, "Label") or self._category_visual_ids(visual_structure, "Card") or ["label_vis_1"]
        global_visual_ids = self._category_visual_ids(visual_structure, "Global")
        label_by_hierarchy = self._label_style_by_hierarchy(visual_structure or {})

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
            if self._is_region_like_point(feature):
                continue
            props = feature.setdefault("properties", {})
            day_num = self._normalize_day(props.get("day") or props.get("day_index") or props.get("name") or props.get("description"), fallback=1)
            props["day"] = f"D{day_num}"
            day_counts[day_num] = day_counts.get(day_num, 0) + 1
            props["order"] = self._normalize_order(props.get("order") or props.get("sequence"), fallback=day_counts[day_num])
            props.pop("card_coord", None)
            props.pop("card_visual_id", None)
            if props.get("visual_id") not in point_visual_ids:
                props["visual_id"] = point_visual_ids[(day_num - 1) % len(point_visual_ids)]
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
        max_pois_per_day = 5
        for day_num in sorted(points_by_day):
            day_points = sorted(
                points_by_day[day_num],
                key=lambda feat: self._normalize_order(feat.get("properties", {}).get("order")),
            )[:max_pois_per_day]
            for index, feature in enumerate(day_points):
                props = feature.setdefault("properties", {})
                coords = feature.get("geometry", {}).get("coordinates")
                hierarchy = self._normalize_label_hierarchy(props.get("label_hierarchy") or props.get("hierarchy"), index)
                content_type = self._normalize_label_content_type(props.get("label_content_type") or props.get("content_type"), hierarchy, props)
                props["day"] = f"D{day_num}"
                props["order"] = index + 1
                props["label_hierarchy"] = hierarchy
                props["label_content_type"] = content_type
                props["label_title"] = props.get("label_title") or props.get("name") or ""
                if not props.get("label_script"):
                    props["label_script"] = str(props.get("description") or "")[:36]
                if "label_extra_info" not in props:
                    props["label_extra_info"] = props.get("open_time") or props.get("ticket") or props.get("transport") or ""
                props["label_coord"] = props.get("label_coord") or coords
                if props.get("label_visual_id") not in label_visual_ids:
                    props["label_visual_id"] = (
                        label_by_hierarchy.get(hierarchy)
                        or label_visual_ids[min(index, len(label_visual_ids) - 1)]
                    )
                for noisy_key in ["global_title", "global_description", "trip_summary", "total_budget"]:
                    props.pop(noisy_key, None)
                kept_points.append(feature)

        rebuilt_routes = []
        for route_index, day_num in enumerate(sorted(points_by_day)):
            day_points = [p for p in kept_points if self._normalize_day(p.get("properties", {}).get("day")) == day_num]
            if len(day_points) < 2:
                continue
            existing_props = dict(existing_routes_by_day.get(day_num) or {})
            if existing_props.get("visual_id") not in route_visual_ids:
                existing_props["visual_id"] = route_visual_ids[route_index % len(route_visual_ids)]
            existing_props["name"] = existing_props.get("name") or f"D{day_num} 旅行路线"
            existing_props["day"] = f"D{day_num}"
            existing_props["description"] = "→".join(p.get("properties", {}).get("name", "") for p in day_points)
            rebuilt_routes.append({
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [p.get("geometry", {}).get("coordinates") for p in day_points],
                },
                "properties": existing_props,
            })

        global_properties = geojson_data.setdefault("global_properties", [])
        if global_properties and global_visual_ids:
            for index, item in enumerate(global_properties):
                if isinstance(item, dict):
                    item.setdefault("visual_id", global_visual_ids[min(index, len(global_visual_ids) - 1)])

        geojson_data["features"] = kept_points + rebuilt_routes
        return geojson_data

    def _annotate_feature_metadata(self, geojson_data: dict) -> dict:
        """Add stable feature ids and machine-readable visual-to-content mappings."""
        features = geojson_data.get("features", [])
        counters = {"Point": 0, "LineString": 0, "Polygon": 0}
        prefixes = {"Point": "poi", "LineString": "route", "Polygon": "area"}
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
                    "Polygon": "area",
                }.get(geom_type, "feature")

            for visual_key in ["visual_id", "card_visual_id", "label_visual_id"]:
                visual_id = properties.get(visual_key)
                if not visual_id:
                    continue
                item = visual_mapping.setdefault(
                    visual_id,
                    {
                        "visual_id": visual_id,
                        "applied_to": [],
                        "properties": [],
                    }
                )
                item["applied_to"].append(properties["feature_id"])
                if visual_key not in item["properties"]:
                    item["properties"].append(visual_key)

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
                geojson_data = self._correct_and_sync_topology(geojson_data)
                geojson_data = self._normalize_travel_semantics(geojson_data, state.visual_structure)
                geojson_data = self._annotate_feature_metadata(geojson_data)
                if "global_properties" not in geojson_data:
                    geojson_data["global_properties"] = [
                        {"title": state.global_title, "visual_id": "global_vis_1"}
                    ]

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
