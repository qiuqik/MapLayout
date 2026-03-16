import time
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from ..utils.agent_utils import AgentState, _escape_prompt_braces, _extract_first_json_object, _robust_json_loads
from ..utils.geo_utils import compute_convex_hull
from ..amap_service import AMapService


class GeoJSONGenerationNode:
    """Node 3: 数据结构化与拓扑映射 (Model: GPT-5/o1)
    
    输入: 节点 1 的意图丰富结果 + 节点 2 的视觉结构
    逻辑: 将用户的旅行规划提取为标准的 GeoJSON 格式，并将规划中的元素与 visual.json 中的视觉分类 `visual_id` 一一对应
    输出: 标准的 GeoJSON FeatureCollection
    """
    
    def __init__(self, llm: ChatOpenAI, amap_service: AMapService = None):
        self.llm = llm
        self.amap_service = amap_service or AMapService()
        
        geojson_example = '''{
  "type": "FeatureCollection",
  "global_properties": [
      {
        "title": "2 天 1 夜北京核心景点游",
        "description": "D1：天安门广场（东城）→故宫博物院→景山公园→王府井步行街；D2：八达岭长城（延庆区，德胜门乘 877 路直达）→返程。行程沿中轴线向北延伸，交通便捷。预算涵盖交通/住宿/门票/餐饮，合理分配轻松出行。",
        "visual_id": "global_vis_1"
      },
      {
        "title": "天安门→故宫→景山→王府井→长城",
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
        "description": "天安门→故宫→景山→长城"
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
    }
  ]
}'''

        safe_geojson_example = _escape_prompt_braces(geojson_example)
        
        system_prompt = f"""你是一个专业的地图数据工程师。你将接收：
1.[用户的详实旅行规划文本]
2.[地图视觉元素字典 visual.json]

你的任务是：将用户的旅行规划提取为标准的 GeoJSON 格式，并将规划中的元素与 visual.json 中的视觉分类 `visual_id` 对应。

## 严格数据结构规则：

1. 全局属性 (global_properties)：
   - 必须在 FeatureCollection 顶层生成 `global_properties` 数组。将文本中的总揽信息提取为对象，并绑定 visual.json 中的 Global 类 `visual_id`。

2. **地理实体映射 (features)**：
   - `geometry.type` 必须严格是 `Point`、`LineString` 或 `Polygon`。
   - 必须绑定对应的 `visual_id`。

3. **生成 Area (Polygon)**：
   - 如果文本中存在游览"区域/范围/行政区"，请生成 Polygon Feature。
   - **不需要计算真实的闭合边界**：只需在 Polygon 的 coordinates 数组中，平铺放入【所有属于该区域的 Point 的经纬度坐标】（形如 `[[[lng1, lat1], [lng2, lat2], ...]]`），下游会自动计算最小凸包。

4. **属性扁平化组合 (针对 Point 和 Area)**：
   - **不要为 Card 或 Label 单独生成 Feature**。如果某个点（Point）或区域（Area）需要附带卡片或标签，请**直接在该 Feature 的 properties 中追加**：
     - `card_coord`:[卡片的经纬度坐标]
     - `card_visual_id`: 对应的卡片 visual_id
     - `label_coord`: [标签的文本经纬度坐标]
     - `label_visual_id`: 对应的标签 visual_id

5. **路线生成 (Route)**：
   - 将相关 POI 串联成 `LineString`。

**对于 visual.json 中没有的项，或该项在文本中无意义，就无需生成对应数据。** 严格输出合法的 JSON 格式。

**示例输出：**
{safe_geojson_example}"""
        
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            ("human", "用户旅行规划：\n{intent_enriched}\n\n视觉元素字典：\n{visual_structure}\n\n请生成 GeoJSON 数据：")
        ])
        
        self.chain = self.prompt | self.llm
    

    
    def _correct_coordinates_with_amap(self, geojson_data: dict) -> dict:
        """使用高德地图 API 修正 POI 坐标"""
        if not geojson_data or "features" not in geojson_data:
            return geojson_data
        
        # 首先修正所有 Point 类型的坐标
        point_coords_map = {}
        for feature in geojson_data["features"]:
            if feature.get("geometry", {}).get("type") == "Point":
                props = feature.get("properties", {})
                name = props.get("name", "")
                
                if name:
                    keyword = name
                    coords = self.amap_service.search_poi(keyword)
                    
                    if coords:
                        print(f"✅ 已修正 [{keyword}] 坐标: {coords}")
                        old_coords = feature["geometry"]["coordinates"]
                        new_coords = list(coords)
                        feature["geometry"]["coordinates"] = new_coords
                        # 记录坐标映射，用于后续修正 LineString 和 Polygon
                        point_coords_map[tuple(old_coords)] = new_coords
                    else:
                        print(f"⚠️ 未找到 [{keyword}] 的坐标，保留原始坐标")
        
        # 修正 LineString 类型的坐标
        for feature in geojson_data["features"]:
            if feature.get("geometry", {}).get("type") == "LineString":
                coords = feature["geometry"]["coordinates"]
                corrected_coords = []
                for coord in coords:
                    if tuple(coord) in point_coords_map:
                        corrected_coords.append(point_coords_map[tuple(coord)])
                    else:
                        corrected_coords.append(coord)
                feature["geometry"]["coordinates"] = corrected_coords
        
        # 修正 Polygon 类型的坐标并计算最小凸包
        for feature in geojson_data["features"]:
            if feature.get("geometry", {}).get("type") == "Polygon":
                # 收集所有点（包括修正后的 Point 坐标）
                all_points = []
                
                # 首先收集 Polygon 原始坐标
                coords = feature["geometry"]["coordinates"]
                for ring in coords:
                    for coord in ring:
                        if tuple(coord) in point_coords_map:
                            all_points.append(tuple(point_coords_map[tuple(coord)]))
                        else:
                            all_points.append(tuple(coord))
                
                # 然后收集所有 Point 类型的坐标（确保包含所有相关点）
                for point_feature in geojson_data["features"]:
                    if point_feature.get("geometry", {}).get("type") == "Point":
                        point_coords = point_feature["geometry"]["coordinates"]
                        all_points.append(tuple(point_coords))
                
                # 去重
                all_points = list(set(all_points))
                
                # 计算最小凸包
                convex_hull = compute_convex_hull(all_points)
                # 更新 Polygon 的 coordinates
                feature["geometry"]["coordinates"] = [convex_hull]
                print(f"✅ 已为 Polygon 计算并更新凸包，包含 {len(convex_hull)} 个点")
        
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
                
                response = self.chain.invoke({
                    "intent_enriched": state.intent_enriched,
                    "visual_structure": visual_structure_str
                })
                content = response.content
                
                json_str = _extract_first_json_object(content)
                if json_str:
                    try:
                        geojson_data = json.loads(json_str)
                    except json.JSONDecodeError:
                        geojson_data = _robust_json_loads(json_str)
                    
                    # 添加全局属性（如果不存在）
                    if "global_properties" not in geojson_data:
                        geojson_data["global_properties"] = [
                            {
                                "title": state.global_title,
                                "description": state.global_description,
                                "visual_id": "global_vis_1"
                            }
                        ]
                    
                    geojson_data = self._correct_coordinates_with_amap(geojson_data)
                    
                    state.geojson_data = geojson_data
                    print(f"✅ [Node 3] GeoJSON 生成完成")
                    print(f"   生成的特征数量: {len(geojson_data.get('features', []))}")
                    return state
                else:
                    raise ValueError("无法解析 GeoJSON")
                    
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
