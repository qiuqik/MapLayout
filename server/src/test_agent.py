"""
多模态地图生成 Agent 测试文件
用于测试每个节点的输出效果，方便进行消融实验
"""

import os
import sys
import json
from datetime import datetime

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from src.multi_modal_agent import MultiModalMapAgent


def test_full_flow():
    """测试完整的多模态地图生成流程"""
    print("=" * 60)
    print("🧪 测试完整的多模态地图生成流程")
    print("=" * 60)
    
    # 测试用例
    user_text = "我想在周末去北京旅游，主要想去故宫、天安门和长城，希望能有一个详细的路线规划。"
    image_path = None  # 可以根据需要指定参考图片路径
    
    agent = MultiModalMapAgent(output_dir="test_output")
    result = agent.run(user_text, image_path)
    
    print("\n📋 测试结果:")
    print(f"会话ID: {result.get('session_id')}")
    print(f"会话目录: {result.get('session_dir')}")
    print(f"是否成功: {'成功' if 'error' not in result else '失败'}")
    
    if 'error' in result:
        print(f"错误信息: {result['error']}")
    else:
        print(f"全局标题: {result.get('global_title')}")
        print(f"全局描述: {result.get('global_description')}")
        print(f"生成的 GeoJSON 特征数量: {len(result.get('geojson', {}).get('features', []))}")
        print(f"生成的 Overlay 数量: {len(result.get('style_code', {}).get('overlays', []))}")
    
    print("=" * 60)
    return result


def test_intent_enrichment():
    """测试意图丰富节点"""
    print("=" * 60)
    print("🧪 测试意图丰富节点")
    print("=" * 60)
    
    from src.nodes.intent_enrichment import IntentEnrichmentNode
    from langchain_openai import ChatOpenAI
    from src.multi_modal_agent import AgentState
    
    # 初始化 LLM
    import os
    from dotenv import load_dotenv
    load_dotenv(".env")
    
    openai_key = os.getenv("OPENAI_API_KEY")
    http_proxy = os.getenv("HTTP_PROXY")
    llm_model = os.getenv("LLM_MODEL", "gpt-4o")
    
    llm = ChatOpenAI(
        api_key=openai_key,
        model=llm_model,
        base_url=http_proxy,
        temperature=0.7
    )
    
    # 创建意图丰富节点
    intent_node = IntentEnrichmentNode(llm)
    
    # 测试用例
    user_text = "我想在周末去上海旅游，主要想去外滩和迪士尼。"
    state = AgentState(
        session_id=f"test_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
        user_text=user_text
    )
    
    # 执行节点
    result_state = intent_node.execute(state)
    
    print("\n📋 测试结果:")
    print(f"原始文本: {user_text}")
    print(f"增强后的意图: {result_state.intent_enriched[:200]}...")
    print(f"全局标题: {result_state.global_title}")
    print(f"全局描述: {result_state.global_description}")
    print(f"是否成功: {'成功' if not result_state.error else '失败'}")
    
    if result_state.error:
        print(f"错误信息: {result_state.error}")
    
    print("=" * 60)
    return result_state


def test_visual_structure():
    """测试视觉结构解析节点"""
    print("=" * 60)
    print("🧪 测试视觉结构解析节点")
    print("=" * 60)
    
    from src.nodes.visual_structure import VisualStructureNode
    from langchain_openai import ChatOpenAI
    from src.multi_modal_agent import AgentState
    
    # 初始化 LLM
    import os
    from dotenv import load_dotenv
    load_dotenv(".env")
    
    vlm_key = os.getenv("QwenVLM_API_KEY")
    
    llm = ChatOpenAI(
        api_key=vlm_key,
        model="qwen-vl-max",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        temperature=0.7
    )
    
    # 创建视觉结构解析节点
    visual_node = VisualStructureNode(llm)
    
    # 测试用例（无图片，使用默认结构）
    state = AgentState(
        session_id=f"test_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
        user_text="测试视觉结构解析",
        image_path=None
    )
    
    # 执行节点
    result_state = visual_node.execute(state)
    
    print("\n📋 测试结果:")
    print(f"视觉结构: {json.dumps(result_state.visual_structure, ensure_ascii=False, indent=2)}")
    print(f"是否成功: {'成功' if not result_state.error else '失败'}")
    
    if result_state.error:
        print(f"错误信息: {result_state.error}")
    
    print("=" * 60)
    return result_state


def test_geojson_generation():
    """测试 GeoJSON 生成节点"""
    print("=" * 60)
    print("🧪 测试 GeoJSON 生成节点")
    print("=" * 60)
    
    from src.nodes.geojson_generation import GeoJSONGenerationNode
    from langchain_openai import ChatOpenAI
    from src.multi_modal_agent import AgentState
    from src.amap_service import AMapService
    
    # 初始化 LLM
    import os
    from dotenv import load_dotenv
    load_dotenv(".env")
    
    openai_key = os.getenv("OPENAI_API_KEY")
    http_proxy = os.getenv("HTTP_PROXY")
    llm_model = os.getenv("LLM_MODEL", "gpt-4o")
    
    llm = ChatOpenAI(
        api_key=openai_key,
        model=llm_model,
        base_url=http_proxy,
        temperature=0.7
    )
    
    # 创建 GeoJSON 生成节点
    geojson_node = GeoJSONGenerationNode(llm, AMapService())
    
    # 测试用例
    state = AgentState(
        session_id=f"test_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
        user_text="测试 GeoJSON 生成",
        intent_enriched="用户想在周末去北京旅游，主要想去故宫、天安门和长城，希望能有一个详细的路线规划。",
        global_title="北京周末游",
        global_description="包含故宫、天安门和长城的两天一夜旅游路线",
        visual_structure={
            "BaseMap": [{"visual_id": "basemap_1", "type": "blank", "description": "纯色极简底图"}],
            "Route": [{"visual_id": "route_main", "description": "所有 POI 的连线，表示导航路线"}],
            "PointMarker": [{"visual_id": "point_poi", "description": "POI 坐标图标"}],
            "Card": [{"visual_id": "card_poi", "description": "POI 详细信息卡片"}],
            "Decorator": [{"visual_id": "decorator_main_title", "description": "地图顶部的大标题"}]
        }
    )
    
    # 执行节点
    result_state = geojson_node.execute(state)
    
    print("\n📋 测试结果:")
    print(f"生成的 GeoJSON 特征数量: {len(result_state.geojson_data.get('features', [])) if result_state.geojson_data else 0}")
    print(f"是否成功: {'成功' if not result_state.error else '失败'}")
    
    if result_state.error:
        print(f"错误信息: {result_state.error}")
    else:
        print(f"GeoJSON 数据: {json.dumps(result_state.geojson_data, ensure_ascii=False, indent=2)[:500]}...")
    
    print("=" * 60)
    return result_state


def test_style_code_generation():
    """测试样式代码生成节点"""
    print("=" * 60)
    print("🧪 测试样式代码生成节点")
    print("=" * 60)
    
    from src.nodes.style_code_generation import StyleCodeGenerationNode
    from langchain_openai import ChatOpenAI
    from src.multi_modal_agent import AgentState
    
    # 初始化 LLM
    import os
    from dotenv import load_dotenv
    load_dotenv(".env")
    
    vlm_key = os.getenv("QwenVLM_API_KEY")
    
    llm = ChatOpenAI(
        api_key=vlm_key,
        model="qwen-vl-max",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        temperature=0.7
    )
    
    # 创建样式代码生成节点
    style_node = StyleCodeGenerationNode(llm)
    
    # 测试用例
    state = AgentState(
        session_id=f"test_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
        user_text="测试样式代码生成",
        visual_structure={
            "BaseMap": [{"visual_id": "basemap_1", "type": "blank", "description": "纯色极简底图"}],
            "Route": [{"visual_id": "route_main", "description": "所有 POI 的连线，表示导航路线"}],
            "PointMarker": [{"visual_id": "point_poi", "description": "POI 坐标图标"}],
            "Card": [{"visual_id": "card_poi", "description": "POI 详细信息卡片"}],
            "Decorator": [{"visual_id": "decorator_main_title", "description": "地图顶部的大标题"}]
        },
        geojson_data={
            "type": "FeatureCollection",
            "global_properties": {
                "title": "北京周末游",
                "description": "包含故宫、天安门和长城的两天一夜旅游路线",
                "visual_id": "decorator_main_title"
            },
            "features": [
                {
                    "type": "Feature",
                    "id": "poi_01",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [116.397, 39.94]
                    },
                    "properties": {
                        "element_type": "point",
                        "visual_id": "point_poi",
                        "name": "故宫",
                        "description": "中国明清两代的皇家宫殿"
                    }
                }
            ]
        }
    )
    
    # 执行节点
    result_state = style_node.execute(state)
    
    print("\n📋 测试结果:")
    print(f"生成的 Overlay 数量: {len(result_state.style_code.get('overlays', [])) if result_state.style_code else 0}")
    print(f"是否成功: {'成功' if not result_state.error else '失败'}")
    
    if result_state.error:
        print(f"错误信息: {result_state.error}")
    else:
        print(f"Style Code 数据: {json.dumps(result_state.style_code, ensure_ascii=False, indent=2)[:500]}...")
    
    print("=" * 60)
    return result_state


if __name__ == "__main__":
    print("🚀 开始多模态地图生成 Agent 测试")
    print("=" * 60)
    
    # 测试各个节点
    test_intent_enrichment()
    test_visual_structure()
    test_geojson_generation()
    test_style_code_generation()
    
    # 测试完整流程
    test_full_flow()
    
    print("🎉 测试完成!")
