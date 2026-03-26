import json
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from ..utils.agent_utils import AgentState, _extract_first_json_object, _robust_json_loads
import copy

class ValidationNode:
    """Node 5: GeoJSON 质量验证节点 (Critic Node)

    逻辑: 审查 Node 3(GeoJSON) 的输出是否满足格式、内容与地理合理性要求。
    输出: 验证结果 JSON，包含是否通过以及具体的修改建议。
    """

    def __init__(self, llm: ChatOpenAI):
        self.llm = llm

        system_prompt = """你是一个严苛且专业的地图数据 QA 工程师。你需要审核上游 AI 节点（Node 3）生成的 GeoJSON 数据是否合格。

### 审查标准：

1. **格式与结构检查**：
   - 必须是合法的 FeatureCollection 结构（包含 `type` 和 `features` 字段）。
   - 必须包含 `global_properties` 数组。
   - Feature 的 `geometry.coordinates` 绝对不能包含 null 值或空数组。
   - Point、LineString、Polygon 的坐标层级结构必须正确（Polygon 坐标应为三维数组 `[[[lng, lat],...]]`）。

2. **内容与用户请求一致性**：
   - 生成的地点必须与用户的原始请求相符（城市、景点类型、天数约束等）。
   - 不能有明显遗漏用户指定的关键地点或约束条件。

3. **地点合理性检查（重要）**：
   - 拒绝纯粹的重复（如"故宫"和"故宫博物院"；"宁夏路"与"宁夏路地铁站"是重复冗余的）。
   - **允许合理的层级/包含关系**：例如“南山片区”（区域地标）与“丝绸之路滑雪场”（具体POI）同时存在是合理的；“乌鲁木齐”（集散城市）与市内具体景点同时存在也是合理的。不要将地理包含关系误判为冗余！
   - Point 之间的地理位置不能过于密集（同一条街道的多个毫无意义的坐标点）。
   - LineString 路线的坐标顺序应与行程逻辑相符。

### 🚫 豁免审查清单（绝对不要检查以下内容，否则视为严重违规）：
1. **忽略 Polygon / Area 的实际地理覆盖范围**：为了节省通信 Token，你看到的 Polygon 坐标是经过**大幅裁剪和抽稀的“脱水版”**。它在地图上必然是残缺的，无法包裹住内部的点。因此，绝对不要指责 Polygon "范围太小"或"未覆盖核心点"，只要它是一个合法的三维数组结构即可！
2. **忽略 Label / Card 的坐标偏差**：绝对不要检查 properties 中的 `label_coord`、`card_coord` 等锚点坐标的地理准确性或偏移量。这些标签坐标在后续的前端引擎中会自动进行重计算和碰撞规避，所以当前即使偏差几百公里也无需你指出。
3. **忽略 LineString 细节**：同理，LineString 也被抽稀过，只需关注其连通的起点、终点和大致流向符合行程逻辑即可，不要审查其具体拐点。

### 输出格式要求：
你必须严格输出如下格式的 JSON，不要输出任何其他内容：
{{
  "is_valid": true,
  "failed_node": "none",
  "feedback": ""
}}
或：
{{
  "is_valid": false,
  "failed_node": "node3",
  "feedback": "详细说明发现的问题以及具体的修改建议，例如：哪些地点重复需要删除，哪些字段缺失，哪些结构有误。"
}}"""

        self.prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            ("human", """请审核以下数据：

【原始用户请求】：{user_query}

【Node 3 GeoJSON 输出(坐标已为 QA 校验做过骨架精简，请忽略中间坐标的跳跃)】：
{geojson_data}

请给出你的 QA 验证 JSON 结果：""")
        ])

        self.chain = self.prompt | self.llm

    def _compress_geojson_for_qa(self, geojson_data: dict) -> dict:
        """脱水压缩 GeoJSON：裁剪 LineString 和 Polygon 的超长坐标，避免 Token 溢出"""
        if not geojson_data or not isinstance(geojson_data, dict):
            return geojson_data
            
        # 使用深拷贝，绝不能污染原始的 state.geojson_data
        qa_data = copy.deepcopy(geojson_data)
        
        for feat in qa_data.get("features", []):
            geom = feat.get("geometry") or {}
            geom_type = geom.get("type")
            coords = geom.get("coordinates")
            
            if not coords or not isinstance(coords, list):
                continue
                
            # 压缩 LineString: 只保留前两个和最后两个点
            if geom_type == "LineString" and len(coords) > 4:
                geom["coordinates"] = [coords[0], coords[1], coords[-2], coords[-1]]
                
            # 压缩 Polygon: 只保留外环的前 3 个点和最后 1 个闭合点
            elif geom_type == "Polygon" and len(coords) > 0 and isinstance(coords[0], list):
                ring = coords[0]
                if len(ring) > 5:
                    geom["coordinates"] = [[ring[0], ring[1], ring[2], ring[-1]]]
                    
        return qa_data

    def execute(self, state: AgentState, max_global_retries: int = 3) -> AgentState:
        print("🕵️ [Node 5] GeoJSON 质量验证: 正在审查 Node 3 的输出...")

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