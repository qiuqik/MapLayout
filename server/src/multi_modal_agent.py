"""
多模态地图生成 Agent 架构
MultiModal Map Generation Agent

实现从"用户文本"和"参考图片"生成"GeoJSON 数据"和"Mapbox 样式代码"的自动化流

架构节点:
- Node 1: 意图丰富 (IntentEnrichmentNode) - GPT-5/o1
- Node 2: 视觉结构解析 (VisualStructureNode) - VLM
- Node 3: 数据结构化与拓扑映射 (GeoJSONGenerationNode) - GPT-5/o1
- Node 4: 样式推演与模板引擎 (StyleCodeGenerationNode) - VLM/GPT-5
"""

import os
import json
import base64
import time
from datetime import datetime
from typing import List, Optional, Dict, Any
from pathlib import Path
from pydantic import BaseModel, Field
from concurrent.futures import ThreadPoolExecutor
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.messages import SystemMessage, HumanMessage
from dotenv import load_dotenv
from typing import TypedDict, Literal
from langgraph.graph import StateGraph, END

import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent))
from src.amap_service import AMapService
from src.nodes.intent_enrichment import IntentEnrichmentNode
from src.nodes.visual_structure import VisualStructureNode
from src.nodes.geojson_generation import GeoJSONGenerationNode
from src.nodes.style_code_generation import StyleCodeGenerationNode
from src.nodes.validation_node import ValidationNode
from src.utils.agent_utils import AgentState, _escape_prompt_braces, _cleanup_json_text, _coerce_json_like_literals, _extract_first_json_object, _robust_json_loads



class SessionManager:
    """会话隔离管理 - 每一轮工作流产出存储在独立的 timestamp_sessionID 文件夹中"""
    
    def __init__(self, base_output_dir: str = "output"):
        self.base_output_dir = base_output_dir
        self.current_session_dir: Optional[str] = None
    
    def create_session(self, session_id: Optional[str] = None) -> str:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        session_id = session_id or f"session_{int(time.time())}"
        self.current_session_dir = os.path.join(
            self.base_output_dir, 
            f"{timestamp}_{session_id}"
        )
        os.makedirs(self.current_session_dir, exist_ok=True)
        
        os.makedirs(os.path.join(self.current_session_dir, "node1"), exist_ok=True)
        os.makedirs(os.path.join(self.current_session_dir, "node2"), exist_ok=True)
        os.makedirs(os.path.join(self.current_session_dir, "node3"), exist_ok=True)
        os.makedirs(os.path.join(self.current_session_dir, "node4"), exist_ok=True)
        
        return self.current_session_dir
    
    def get_session_dir(self) -> str:
        if not self.current_session_dir:
            return self.create_session()
        return self.current_session_dir
    
    def save_file(self, content: Any, filename: str, subdir: str = "") -> str:
        session_dir = self.get_session_dir()
        if subdir:
            target_dir = os.path.join(session_dir, subdir)
        else:
            target_dir = session_dir
        
        filepath = os.path.join(target_dir, filename)
        
        if content is None:
            return filepath
        
        if isinstance(content, (dict, list)):
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(content, f, ensure_ascii=False, indent=2)
        else:
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(str(content))
        
        return filepath
    
    def load_file(self, filename: str, subdir: str = "") -> Optional[Any]:
        session_dir = self.get_session_dir()
        if subdir:
            target_dir = os.path.join(session_dir, subdir)
        else:
            target_dir = session_dir
        
        filepath = os.path.join(target_dir, filename)
        if not os.path.exists(filepath):
            return None
        
        with open(filepath, "r", encoding="utf-8") as f:
            if filename.endswith(".json"):
                return json.load(f)
            return f.read()


class GraphState(TypedDict):
    """LangGraph 状态包装器"""
    agent_state: AgentState

class MultiModalMapAgent:
    """多模态地图生成 Agent 主类
    
    整合四个核心节点，实现从用户文本和参考图片生成 GeoJSON 和 Mapbox 样式代码的完整流程
    """
    
    def __init__(self, output_dir: str = "output"):
        load_dotenv()
        
        self.openai_key = os.getenv("OPENAI_API_KEY")
        self.http_proxy = os.getenv("HTTP_PROXY")
        self.llm_model = os.getenv("LLM_MODEL", "gpt-5")
        self.vlm_model_type = os.getenv("VLM_MODEL", "qwen").lower()
        
        if self.vlm_model_type not in ["qwen", "gemini"]:
            raise ValueError(f"⚠️ VLM_MODEL 必须为 'qwen' 或 'gemini'，当前值: {self.vlm_model_type}")
        
        if not self.openai_key:
            raise RuntimeError("⚠️ .env 文件中未配置 OPENAI_API_KEY")
        
        self.llm_for_text = ChatOpenAI(
            api_key=self.openai_key,
            model=self.llm_model,
            base_url=self.http_proxy,
            temperature=0.7
        )
        
        # 根据 VLM_MODEL 类型初始化对应的 VLM 模型
        self.llm_for_vlm = self._init_vlm_model()
        
        self.amap_service = AMapService()
        self.session_manager = SessionManager(output_dir)
        
        self.intent_node = IntentEnrichmentNode(self.llm_for_text)
        self.visual_node = VisualStructureNode(self.llm_for_vlm)
        self.geojson_node = GeoJSONGenerationNode(self.llm_for_text, self.amap_service)
        self.style_node = StyleCodeGenerationNode(self.llm_for_vlm)
        self.validation_node = ValidationNode(self.llm_for_text)

        self.workflow = self._build_graph()
    
    def _build_graph(self):
        """构建核心的状态机有向图"""
        workflow = StateGraph(GraphState)

        # define graph nodes
        def node_init_parallel(data: GraphState):
            """parallel node1 and node2"""
            state = data["agent_state"]
            with ThreadPoolExecutor(max_workers=2) as executor:
                future_intent = executor.submit(self.intent_node.execute, state)
                future_visual = executor.submit(self.visual_node.execute, state)
                state = future_intent.result()
                state = future_visual.result()
            self.session_manager.save_file(
                {"intent_enriched": state.intent_enriched}, f"intent_{state.session_id}.json", "node1"
            )
            self.session_manager.save_file(state.visual_structure, f"visual_{state.session_id}.json", "node2")
            return {"agent_state": state}
        
        def node_geojson(data: GraphState):
            """execute Node 3"""
            state = data["agent_state"]
            state = self.geojson_node.execute(state)
            self.session_manager.save_file(
                state.geojson_data, f"geojson_{state.validation_retry_count}.json", "node3"
            )
            return {"agent_state": state}
        
        def node_validate(data: GraphState):
            """execute Node 5 validate"""
            state = data["agent_state"]
            state = self.validation_node.execute(state)
            return {"agent_state": state}

        def node_style(data: GraphState):
            """execute Node 4 style generate"""
            state = data["agent_state"]
            state = self.style_node.execute(state)
            self.session_manager.save_file(state.style_code, f"style_{state.session_id}.json", "node4")
            return {"agent_state": state}

        def router(data: GraphState) -> str:
            """根据验证节点的结果决定图的走向"""
            state = data["agent_state"]

            # 如果中途发生了硬性错误（非验证相关），直接退出
            if state.error and "验证节点" not in state.error:
                return "to_end"

            # 验证通过 -> 前往生成样式代码
            if state.is_valid:
                return "to_style"

            # 验证未通过，打回 node3 重做（携带 feedback）
            if state.failed_node == "node3":
                return "to_geojson"

            # 兜底：进入样式生成
            return "to_style"
        
        # 节点
        workflow.add_node("InitParallel", node_init_parallel)
        workflow.add_node("GeoJSON", node_geojson)
        workflow.add_node("Validate", node_validate)
        workflow.add_node("Style", node_style)

        # 边
        workflow.add_edge("InitParallel", "GeoJSON")
        workflow.add_edge("GeoJSON", "Validate")    # GeoJSON 生成完，必须去质检

        # 条件边 (动态分支路由)
        workflow.add_conditional_edges(
            "Validate",
            router,
            {
                "to_style": "Style",
                "to_geojson": "GeoJSON",  # 验证不通过，携带 feedback 重做 node3
                "to_end": END
            }
        )
        
        # 收尾
        workflow.add_edge("Style", END)

        # 入口
        workflow.set_entry_point("InitParallel")

        return workflow.compile()

    def _init_vlm_model(self) -> ChatOpenAI:
        """初始化 VLM 模型（支持 QwenVLM 或 Gemini）"""
        if self.vlm_model_type == "qwen":
            qwen_key = os.getenv("QwenVLM_API_KEY")
            if not qwen_key:
                raise RuntimeError("⚠️ .env 文件中未配置 QwenVLM_API_KEY")
            
            return ChatOpenAI(
                api_key=qwen_key,
                model="qwen-vl-max",
                base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
                temperature=0.7
            )
        
        elif self.vlm_model_type == "gemini":
            gemini_key = os.getenv("GEMINI_API_KEY")
            if not gemini_key:
                raise RuntimeError("⚠️ .env 文件中未配置 GEMINI_API_KEY")
            
            return ChatOpenAI(
                api_key=gemini_key,
                model="gemini-3-pro-preview",
                base_url=self.http_proxy,
                temperature=0.7
            )
    
    def run(self, user_text: str, image_path: Optional[str] = None, session_id: Optional[str] = None) -> Dict[str, Any]:
        """执行完整的多模态地图生成流程 (LangGraph)"""
        
        session_dir = self.session_manager.create_session(session_id)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # 1. 初始化状态对象
        state = AgentState(
            session_id=session_id or timestamp,
            user_text=user_text,
            image_path=image_path
        )
        
        print("=" * 60)
        print("🚀 [LangGraph] 开始多模态地图生成流程")
        print(f"   用户需求: {user_text[:50]}...")
        print(f"   参考图片: {image_path or '无'}")
        print("=" * 60)
        
        # 2. 包装状态并启动 LangGraph 引擎
        initial_graph_state: GraphState = {"agent_state": state}
        
        # invoke 会自动按照你定义的拓扑结构执行，直至抵达 END 节点
        final_result_state = self.workflow.invoke(initial_graph_state)
        
        # 3. 剥离并获取最终状态
        final_state: AgentState = final_result_state["agent_state"]
        
        if final_state.error:
            return self._handle_error(final_state)
            
        print("=" * 60)
        print(f"✅ 流程完成! 共经历 {final_state.validation_retry_count} 次自我纠错。")
        print(f"📁 会话目录: {session_dir}")
        print("=" * 60)
        
        return {
            "session_id": final_state.session_id,
            "session_dir": session_dir,
            "intent": final_state.intent_enriched,
            "global_title": final_state.global_title,
            "visual_structure": final_state.visual_structure,
            "geojson": final_state.geojson_data,
            "style_code": final_state.style_code
        }
    
    def _handle_error(self, state: AgentState) -> Dict[str, Any]:
        print(f"❌ 流程执行失败: {state.error}")
        
        return {
            "session_id": state.session_id,
            "session_dir": self.session_manager.get_session_dir(),
            "error": state.error,
            "retry_count": state.retry_count
        }
    
    def get_session_history(self, session_id: str) -> Optional[Dict[str, Any]]:
        """获取指定会话的历史记录"""
        session_dir = os.path.join(self.session_manager.base_output_dir, session_id)
        if not os.path.exists(session_dir):
            return None
        
        history = {}
        
        for subdir in ["node1", "node2", "node3", "node4"]:
            subdir_path = os.path.join(session_dir, subdir)
            if os.path.exists(subdir_path):
                files = os.listdir(subdir_path)
                if files:
                    latest_file = sorted(files)[-1]
                    filepath = os.path.join(subdir_path, latest_file)
                    with open(filepath, "r", encoding="utf-8") as f:
                        history[subdir] = json.load(f)
        
        return history if history else None


# ==========================================
# 本地调试与测试入口
# ==========================================
if __name__ == "__main__":
    import os
    import json

    print("🛠️ 正在初始化 MultiModalMapAgent...")
    try:
        # 确保你在项目根目录有 .env 文件，且配置了 OPENAI_API_KEY 等必要参数
        agent = MultiModalMapAgent(output_dir="debug_outputs")
    except Exception as e:
        print(f"❌ Agent 初始化失败，请检查 .env 配置文件: {e}")
        exit(1)

    # --- 测试用例配置 ---
    # 替换为你本地实际存在的图片路径，如果找不到，Agent 会自动降级为无图模式
    test_image_path = "../images/image_20260311_103818.jpg" 
    if not os.path.exists(test_image_path):
        print(f"⚠️ 未找到测试图片: {test_image_path}，将以【无参考图】模式运行。")
        test_image_path = None

    test_user_text = (
        "帮我规划一个新疆北疆6-8天的滑雪深度游，"
        "以乌鲁木齐为集散中心，想去丝绸之路、阿勒泰将军山和可可托海，"
        "预算大约8000元/人，主要靠高铁和包车。"
    )

    print("\n▶️ 开始执行测试任务...")
    
    # 启动工作流
    result = agent.run(
        user_text=test_user_text,
        image_path=test_image_path,
        session_id="debug_run_001"
    )

    # --- 打印最终调试结果摘要 ---
    print("\n" + "="*60)
    print("🎉 测试运行结束！最终输出摘要：")
    print("="*60)
    
    if "error" in result and result["error"]:
        print(f"❌ 流程遇到致命错误: {result['error']}")
    else:
        print(f"📌 会话 ID: {result.get('session_id')}")
        print(f"📁 输出存放目录: {result.get('session_dir')}")
        print(f"🎯 提取的全局标题: {result.get('global_title')}")
        print(f"📝 行程概览: {result.get('intent', '')[:80]}...")
        
        geojson_features = result.get('geojson', {}).get('features', [])
        print(f"🗺️ GeoJSON 实体数量: {len(geojson_features)} 个")
        
        style_keys = list(result.get('style_code', {}).keys())
        style_keys.remove('_used_visual_ids') if '_used_visual_ids' in style_keys else None
        print(f"🎨 生成的样式组件: {style_keys}")
        
        print("\n👉 提示: 请前往输出目录查看完整的生成的 JSON 静态文件。")
        
        # 调试用：如果你想在终端看到完整的生成的结构，取消下面这两行的注释
        # print("\n【完整返回结果】:")
        # print(json.dumps(result, ensure_ascii=False, indent=2))