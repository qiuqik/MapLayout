import json
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from ..utils.agent_utils import AgentState, _extract_first_json_object, _robust_json_loads
from ..utils.prompt_loader import load_prompt
import copy
import math
import re

class ValidationNode:
    """Node 5: GeoJSON 质量验证节点 (Critic Node)

    逻辑: 审查 Node 3(GeoJSON) 的输出是否满足格式、内容与地理合理性要求。
    输出: 验证结果 JSON，包含是否通过以及具体的修改建议。
    """

    PROMPT_NAME = "validation"
    PROMPT_VERSION = "v0.3"

    def __init__(self, llm: ChatOpenAI):
        self.llm = llm

        system_prompt = load_prompt("validation.md")

        self.prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            ("human", """请审核以下数据：

【原始用户请求】：{user_query}

【Node 3 本轮最新 GeoJSON 输出(只包含本轮生成结果；坐标已为 QA 校验做过骨架精简，请忽略中间坐标的跳跃)】：
{geojson_data}

请给出你的 QA 验证 JSON 结果：""")
        ])

        self.chain = self.prompt | self.llm

    def _compress_geojson_for_qa(self, geojson_data: dict) -> dict:
        """脱水压缩 GeoJSON：裁剪 LineString 的超长坐标，避免 Token 溢出"""
        if not geojson_data or not isinstance(geojson_data, dict):
            return geojson_data
            
        # 使用深拷贝，绝不能污染原始的 state.geojson_data
        qa_data = copy.deepcopy(geojson_data)
        for stale_key in [
            "validation_feedback",
            "validation_retry_count",
            "_validation_feedback",
            "_qa_feedback",
            "_previous_result",
            "_previous_geojson",
        ]:
            qa_data.pop(stale_key, None)
        
        for feat in qa_data.get("features", []):
            if not isinstance(feat, dict):
                continue
            props = feat.get("properties")
            if isinstance(props, dict):
                for stale_key in ["validation_feedback", "_qa_feedback", "_previous_result"]:
                    props.pop(stale_key, None)
            geom = feat.get("geometry") or {}
            geom_type = geom.get("type")
            coords = geom.get("coordinates")
            
            if not coords or not isinstance(coords, list):
                continue
                
            # 压缩 LineString: 只保留前两个和最后两个点
            if geom_type == "LineString" and len(coords) > 4:
                geom["coordinates"] = [coords[0], coords[1], coords[-2], coords[-1]]
                
        return qa_data

    def _normalize_name(self, value: str) -> str:
        return re.sub(r"[\s·•\-_/()（）【】\[\]，,。.:：;；'\"“”]", "", str(value or "").lower())

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

    def _mentioned_by_user(self, name: str, user_text: str) -> bool:
        normalized_name = self._normalize_name(name)
        normalized_user = self._normalize_name(user_text)
        return bool(normalized_name and normalized_name in normalized_user)

    def _macro_area(self, name: str) -> str:
        normalized = self._normalize_name(name)
        for area in ["滨海湾", "圣淘沙", "小印度", "唐人街", "克拉码头"]:
            if self._normalize_name(area) in normalized:
                return area
        return ""

    def _deterministic_geojson_issues(self, state: AgentState) -> list[str]:
        data = state.geojson_data if isinstance(state.geojson_data, dict) else {}
        user_text = state.user_text or ""
        city = str(data.get("_city") or "")
        issues = []
        points = [
            feature for feature in data.get("features", [])
            if feature.get("geometry", {}).get("type") == "Point"
        ]

        if "新加坡" in city or "singapore" in city.lower():
            for feature in points:
                name = (feature.get("properties") or {}).get("name", "")
                coords = feature.get("geometry", {}).get("coordinates")
                try:
                    lon, lat = float(coords[0]), float(coords[1])
                except (TypeError, ValueError, IndexError):
                    continue
                if not (103.55 <= lon <= 104.15 and 1.15 <= lat <= 1.50):
                    issues.append(f"{name} 坐标 {coords} 超出新加坡范围。")

        for feature in points:
            name = (feature.get("properties") or {}).get("name", "")
            normalized = self._normalize_name(name)
            if normalized in {"圣淘沙", "sentosa"}:
                same_day_names = [
                    (item.get("properties") or {}).get("name", "")
                    for item in points
                    if (item.get("properties") or {}).get("day") == (feature.get("properties") or {}).get("day")
                ]
                if any(
                    self._normalize_name(candidate) in {"新加坡环球影城", "环球影城", "sea海洋馆", "sea水族馆", "西乐索海滩"}
                    for candidate in same_day_names
                ):
                    issues.append("圣淘沙是区域/岛屿，不应在已有环球影城、S.E.A.海洋馆、西乐索海滩等具体 POI 时作为单独 Point。")

        for index, first in enumerate(points):
            first_props = first.get("properties") or {}
            first_name = first_props.get("name", "")
            first_day = first_props.get("day")
            first_area = self._macro_area(first_name)
            for second in points[index + 1:]:
                second_props = second.get("properties") or {}
                second_name = second_props.get("name", "")
                if first_day != second_props.get("day"):
                    continue
                dist = self._distance_meters(
                    first.get("geometry", {}).get("coordinates"),
                    second.get("geometry", {}).get("coordinates"),
                )
                second_area = self._macro_area(second_name)
                same_area = first_area and first_area == second_area
                contains = (
                    self._normalize_name(first_name) in self._normalize_name(second_name)
                    or self._normalize_name(second_name) in self._normalize_name(first_name)
                )
                both_requested = self._mentioned_by_user(first_name, user_text) and self._mentioned_by_user(second_name, user_text)
                if not both_requested and dist < 750 and (same_area or contains):
                    requested_names = [
                        name for name in [first_name, second_name]
                        if self._mentioned_by_user(name, user_text)
                    ]
                    action = (
                        f"优先保留用户明确点名的 {requested_names[0]}，删除另一个未点名 POI。"
                        if requested_names
                        else "请 Node3 基于原始用户请求和当天路线语义重新选择其一；若用户未点名这两个 POI，删除更偏离用户请求或更像泛化补点的一个，并同步更新 LineString、point_names 与 global_properties。"
                    )
                    issues.append(
                        f"同一天存在疑似重复/过密 POI：{first_name} 与 {second_name} 相距约 {int(dist)} 米且同属{first_area or '相同'}区域。{action}"
                    )

        return issues

    def execute(self, state: AgentState, max_global_retries: int = 3) -> AgentState:
        print("🕵️ [Node 5] GeoJSON 质量验证: 正在审查 Node 3 的输出...")

        deterministic_issues = self._deterministic_geojson_issues(state)
        if deterministic_issues and state.validation_retry_count < max_global_retries:
            state.is_valid = False
            state.failed_node = "node3"
            state.validation_feedback = " ".join(deterministic_issues)
            state.validation_retry_count += 1
            print(f"   ⚠️ [Node 5] 程序化验证未通过，打回给 [node3]（第 {state.validation_retry_count} 次）。")
            print(f"   📝 QA 建议: {state.validation_feedback}")
            return state

        # 防止无限死循环
        if state.validation_retry_count >= max_global_retries:
            print("❌ [Node 5] 达到全局最大纠错重试次数，强制终止。")
            state.is_valid = True  # 强制放行，进入 node4
            return state

        try:
            # 将字典转为字符串喂给大模型，截断防止 token 溢出
            compressed_geojson = self._compress_geojson_for_qa(state.geojson_data)
            geojson_str = json.dumps(compressed_geojson, ensure_ascii=False)
            response = self.chain.invoke({
                "user_query": state.user_text,
                "geojson_data": geojson_str
            })

            json_str = _extract_first_json_object(response.content)
            result = _robust_json_loads(json_str)

            state.is_valid = result.get("is_valid", False)
            state.failed_node = result.get("failed_node", "none")
            state.validation_feedback = result.get("feedback", "")

            if state.is_valid:
                print("   ✅ [Node 5] 验证通过！数据质量合格。")
            else:
                state.validation_retry_count += 1
                print(f"   ⚠️ [Node 5] 验证未通过，打回给 [node3]（第 {state.validation_retry_count} 次）。")
                print(f"   📝 QA 建议: {state.validation_feedback}")

            return state

        except Exception as e:
            print(f"⚠️ [Node 5] 验证节点自身执行出错: {e}")
            # 验证节点崩溃时放行，避免阻断主流程
            state.is_valid = True
            state.error = f"验证节点解析失败（已放行）: {str(e)}"
            return state
