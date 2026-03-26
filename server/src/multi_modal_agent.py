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
from concurrent.futures import ThreadPoolExecutor
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.messages import SystemMessage, HumanMessage
from dotenv import load_dotenv

from src.amap_service import AMapService
from src.nodes.intent_enrichment import IntentEnrichmentNode
from src.nodes.visual_structure import VisualStructureNode
from src.nodes.geojson_generation import GeoJSONGenerationNode
from src.nodes.style_code_generation import StyleCodeGenerationNode
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


class MultiModalMapAgent:
    """多模态地图生成 Agent 主类
    
    整合四个核心节点，实现从用户文本和参考图片生成 GeoJSON 和 Mapbox 样式代码的完整流程
    """
    
    def __init__(self, output_dir: str = "output"):
        load_dotenv(".env")
        
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
        """执行完整的多模态地图生成流程"""
        
        session_dir = self.session_manager.create_session(session_id)
        print(f"📁 会话目录: {session_dir}")
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        state = AgentState(
            session_id=session_id or timestamp,
            user_text=user_text,
            image_path=image_path
        )
        
        print("=" * 60)
        print("🚀 开始多模态地图生成流程")
        print(f"   用户需求: {user_text[:50]}...")
        print(f"   参考图片: {image_path or '无'}")
        print(f"   VLM 模型: {self.vlm_model_type.upper()}")
        print("=" * 60)
        
        # 并行执行 Node 1 和 Node 2
        with ThreadPoolExecutor(max_workers=2) as executor:
            # 执行意图丰富节点
            future_intent = executor.submit(self.intent_node.execute, state)
            # 执行视觉结构解析节点
            future_visual = executor.submit(self.visual_node.execute, state)
            
            # 获取执行结果
            state_intent = future_intent.result()
            state_visual = future_visual.result()
            
            # 合并结果
            state.intent_enriched = state_intent.intent_enriched
            state.global_title = state_intent.global_title
            state.global_description = state_intent.global_description
            state.visual_structure = state_visual.visual_structure
            
            # 检查错误
            if state_intent.error:
                state.error = state_intent.error
            elif state_visual.error:
                state.error = state_visual.error
        
        # 保存 Node 1 结果
        self.session_manager.save_file(
            {
                "user_text": user_text, 
                "intent_enriched": state.intent_enriched,
                "global_title": state.global_title,
                "global_description": state.global_description
            },
            f"intent_{timestamp}.json",
            "node1"
        )
        
        # 保存 Node 2 结果
        self.session_manager.save_file(
            state.visual_structure,
            f"visual_{timestamp}.json",
            "node2"
        )
        
        if state.error:
            return self._handle_error(state)
        
        # Node 3: 数据结构化与拓扑映射
        state = self.geojson_node.execute(state)
        
        self.session_manager.save_file(
            state.geojson_data,
            f"geojson_{timestamp}.json",
            "node3"
        )
        
        if state.error:
            if "GeoJSON" in state.error and state.retry_count > 0:
                print("🔄 触发重试机制: 重新进行意图理解和 GeoJSON 生成")
                state.intent_enriched = None
                state.geojson_data = None
                state.error = None
                state.retry_count = 0
                
                state = self.intent_node.execute(state)
                state = self.geojson_node.execute(state)
                
                self.session_manager.save_file(
                    state.geojson_data,
                    f"geojson_retry_{timestamp}.json",
                    "node3"
                )
            
            if state.error:
                return self._handle_error(state)
        
        # Node 4: 样式推演与模板引擎
        state = self.style_node.execute(state)
        
        self.session_manager.save_file(
            state.style_code,
            f"style_{timestamp}.json",
            "node4"
        )
        
        if state.error:
            return self._handle_error(state)
        
        final_result = {
            "session_id": state.session_id,
            "session_dir": session_dir,
            "intent": state.intent_enriched,
            "global_title": state.global_title,
            "global_description": state.global_description,
            "visual_structure": state.visual_structure,
            "geojson": state.geojson_data,
            "style_code": state.style_code
        }
        
        print("=" * 60)
        print("✅ 多模态地图生成流程完成!")
        print(f"   会话目录: {session_dir}")
        print("=" * 60)
        
        return final_result
    
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
