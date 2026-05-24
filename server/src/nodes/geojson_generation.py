import time
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from ..utils.agent_utils import AgentState, _escape_prompt_braces, _extract_first_json_object, _robust_json_loads
from ..utils.prompt_loader import load_prompt
from ..validators.schema_validators import validate_geojson

from ..amap_service import AMapService
from shapely.geometry import MultiPoint, Polygon as ShapelyPolygon
import math

class GeoJSONGenerationNode:
    """Node 3: 数据结构化与拓扑映射 (Model: GPT-5/o1)
    
    输入: 节点 1 的意图丰富结果 + 节点 2 的视觉结构
    逻辑: 将用户的旅行规划提取为标准的 GeoJSON 格式，并将规划中的元素与 visual.json 中的视觉分类 `visual_id` 一一对应
    输出: 标准的 GeoJSON FeatureCollection
    """

    PROMPT_NAME = "geojson_generation"
    PROMPT_VERSION = "v0.1"
    
    def __init__(self, llm: ChatOpenAI, amap_service: AMapService = None):
        self.llm = llm
        self.amap_service = amap_service or AMapService()
        
        geojson_example = '''{
  "_mapping_thought": "参考图虽然是新疆滑雪场，但提供了 Area 和 Card 容器。我将北京行程按地理划分为'东城区'和'延庆区'两个 Polygon，并复用 area_vis_1 和 area_vis_2，为它们生成了对应的总结 Card。",
  "_city":"北京",
  "type": "FeatureCollection",
  "global_properties": [
      {
        "title": "2 天 1 夜北京核心景点游",
        "description": "D1：天安门广场（东城）→故宫博物院；D2：八达岭长城（延庆区，德胜门乘 877 路直达）→返程。",
        "visual_id": "global_vis_1"
      },
      {
        "title": "天安门→故宫→长城",
        "description": "简单总结",
        "visual_id": " global_vis_2"
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
          [116.395, 39.923],
          [116.412, 39.913],
          [116.416, 40.359]
        ]
      },
      "properties": {
        "visual_id": "route_vis_1",
        "name": "北京核心景点路线",
        "description": "天安门→故宫→长城"
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
        "description": "东城，行程起点",
        "open_time":"全天开放",
        "card_coord": [116.0, 39.5],
        "card_visual_id": "card_vis_1",
        "label_coord": [116.390, 39.809],
        "label_visual_id": "label_vis_1"
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
        "description": "核心景点，需预约",
        "open_time":"9:00am-17:00pm",
        "card_coord": [116.1, 39.7],
        "card_visual_id": "card_vis_1",
        "label_coord": [116.390, 39.809],
        "label_visual_id": "label_vis_1"
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
        "description": "延庆区，D2 行程",
        "open_time":"8:00am-22:00pm",
        "card_coord": [116.0, 39.5],
        "card_visual_id": "card_vis_1",
        "label_coord": [116.390, 39.809],
        "label_visual_id": "label_vis_1"
      }
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [116.416,39.928]
      },
      "properties": {
        "visual_id": "point_vis_2",
        "name": "东城区",
        "label_coord": [116.390, 39.809],
        "label_visual_id": "label_vis_1"
      }
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [115.974,40.457]
      },
      "properties": {
        "visual_id": "point_vis_2",
        "name": "延庆区",
        "label_coord": [116.390, 39.809],
        "label_visual_id": "label_vis_1"
      }
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "Polygon",
        "coordinates": [[
            [116.390, 39.809],
            [116.416,39.928]
        ]]
      },
      "properties": {
        "visual_id": "area_vis_1",
        "name": "东城区",
      }
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "Polygon",
        "coordinates": [[
            [115.974,40.457],
            [115.974,40.457],
            [115.974,40.457]
        ]]
      },
      "properties": {
        "visual_id": "area_vis_2",
        "name": "延庆区",
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

        # 3. 同步更新 Polygon (直接基于 LLM 划分的面)
        valid_polygons = []
        
        # --- 第一步：收集所有基础凸包，并寻找全局最大跨度 ---
        temp_hulls = []
        max_diagonal_span = 0.0005 # 极小值兜底，防止全部是单点或极小区域
        
        for feat in features:
            if feat.get("geometry", {}).get("type") == "Polygon":
                # Polygon 的坐标通常包裹在一层额外的数组中
                raw_poly_coords = feat["geometry"]["coordinates"][0] 
                updated_poly_coords = []
                
                for pt in raw_poly_coords:
                    t_pt = tuple(pt)
                    # 替换多边形内部的坐标
                    if t_pt in coord_map:
                        updated_poly_coords.append(coord_map[t_pt])
                    else:
                        updated_poly_coords.append(pt)
                
                # 去重获取唯一独立点集
                unique_coords = []
                for pt in updated_poly_coords:
                    if pt not in unique_coords:
                        unique_coords.append(pt)

                # 仅处理有效点数 >= 2 的多边形
                if len(unique_coords) >= 1:
                    hull = MultiPoint(unique_coords).convex_hull
                    minx, miny, maxx, maxy = hull.bounds
                    
                    # 计算当前多边形的对角线跨度
                    span = math.hypot(maxx - minx, maxy - miny)
                    if span > max_diagonal_span:
                        max_diagonal_span = span
                        
                    # 暂存基础凸包和特征，用于第二步
                    temp_hulls.append({
                        "feature": feat,
                        "hull": hull
                    })
                else:
                    print(f"   ⚠️ Polygon [{feat.get('properties', {}).get('name', '未命名')}] 剩余有效点不足 2 个，已移除")

        # --- 第二步：根据最大跨度计算统一 padding，并应用到所有凸包 ---
        # 动态 padding 距离为全局最大跨度的 8% (比例可视前端 UI 效果微调)
        global_dynamic_buffer = max(0.0005, max_diagonal_span * 0.08)

        for item in temp_hulls:
            feat = item["feature"]
            hull = item["hull"]

            # 使用统一的全局 buffer 进行外扩
            buffered_hull = hull.buffer(global_dynamic_buffer, quad_segs=8, join_style=1)

            if isinstance(buffered_hull, ShapelyPolygon):
                feat["geometry"]["coordinates"] = [list(buffered_hull.exterior.coords)]
                valid_polygons.append(feat)

        # 4. 将过滤后的有效 features 写回 geojson_data
        geojson_data["features"] = valid_points + valid_lines + valid_polygons
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
