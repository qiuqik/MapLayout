from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from ..utils.agent_utils import AgentState
from ..utils.prompt_loader import load_prompt


class IntentEnrichmentNode:
    """Node 1: 意图丰富 (Model: GPT-5/o1)
    
    输入: 用户原始文本
    逻辑: 进行意图丰富 (Intent Enrichment)，识别任务目标，主动识别并合理推测缺失的关键信息
    输出: 丰富后的完整意图描述、全局标题与说明、具体行程安排
    """

    PROMPT_NAME = "intent_enrichment"
    PROMPT_VERSION = "v0.2"
    
    def __init__(self, llm: ChatOpenAI):
        self.llm = llm
        
        system_prompt = load_prompt("intent_enrichment.md")
        
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
