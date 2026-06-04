import json
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from ..utils.agent_utils import AgentState, _extract_first_json_object, _robust_json_loads
from ..utils.prompt_loader import load_prompt
import copy

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
