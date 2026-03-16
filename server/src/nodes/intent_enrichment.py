from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from ..utils.agent_utils import AgentState


class IntentEnrichmentNode:
    """Node 1: 意图丰富 (Model: GPT-5/o1)
    
    输入: 用户原始文本
    逻辑: 进行意图丰富 (Intent Enrichment)，识别任务目标，主动识别并合理推测缺失的关键信息
    输出: 丰富后的完整意图描述、全局标题与说明、具体行程安排
    """
    
    def __init__(self, llm: ChatOpenAI):
        self.llm = llm
        
        system_prompt = """你是一个专业的旅游规划顾问和意图分析专家。你的任务是分析用户的旅游需求，进行意图丰富 (Intent Enrichment)。

## 分析要求：
1. **任务目标识别**：识别用户想要做什么（如旅游路线规划、区域范围游览、地点推荐等），并严格遵守用户的预算限制。
2. **缺失信息推测**：主动推测合理的目的地、天数、出行方式。
3. **行程生成与精简输出**：用极度精简、干练的文字描述行程。必须明确包含具体的 POI（兴趣点）名称、所属行政区/游玩范围（区域）、以及关键的交通指引（如直达公交/地铁等）。

## 输出格式要求：
请直接输出一段紧凑的纯文本，不要使用 Markdown 复杂排版（不需要加粗或多级列表）。
格式参考：
"[总述：如 2天1夜XX游，预算XXX元]。D1：地点A（所属区）→地点B→地点C；D2：地点D（所属区，交通方式）→返程。 [简短的总结说明]。"
请直接给出结果，不需要任何多余的解释。"""
        
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            ("human", "{user_text}")
        ])
        
        self.chain = self.prompt | self.llm
    
    def execute(self, state: AgentState) -> AgentState:
        print("🧠 [Node 1] 意图丰富: 正在进行意图分析与行程规划...")
        try:
            response = self.chain.invoke({"user_text": state.user_text})
            content = response.content
            
            # 解析输出，提取行程信息
            state.intent_enriched = content.strip()
            
            # 提取全局标题和说明
            # 从总述中提取标题
            if content.startswith("["):
                end_bracket = content.find("]")
                if end_bracket != -1:
                    state.global_title = content[1:end_bracket].strip()
                else:
                    state.global_title = "旅游行程"
            else:
                state.global_title = "旅游行程"
            
            # 提取说明文字
            if "。 [" in content:
                start_bracket = content.find("。 [")
                if start_bracket != -1:
                    state.global_description = content[start_bracket+3:-1].strip()
                else:
                    state.global_description = "根据用户需求生成的旅游行程"
            else:
                state.global_description = "根据用户需求生成的旅游行程"
            
            print(f"✅ [Node 1] 意图丰富完成")
            print(f"   全局标题: {state.global_title}")
            print(f"   行程概览: {state.intent_enriched[:100]}...")
            
        except Exception as e:
            # 降级处理
            state.intent_enriched = state.user_text
            state.global_title = "旅游行程"
            state.global_description = "根据用户需求生成的旅游行程"
            state.error = f"意图丰富失败: {str(e)}"
            print(f"⚠️ [Node 1] 意图丰富失败，已降级处理: {e}")
        
        return state
