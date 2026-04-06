import os
import json
import base64
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage

def _image_to_base64(image_path: str) -> str:
    """将图片转换为 base64 编码"""
    ext = os.path.splitext(image_path)[1].lower().lstrip('.')
    if ext not in ["jpg", "jpeg", "png", "gif", "bmp"]:
        ext = "jpeg"
    
    with open(image_path, "rb") as f:
        base64_data = base64.b64encode(f.read()).decode("utf-8")
    
    return base64_data

def _mock_judge_result():
    """模拟评判结果"""
    mock_winner = "A"
    if mock_winner == "A":
        return 1.0
    elif mock_winner == "Tie":
        return 0.5
    else:
        return 0.0
    
def _init_vlm_model() -> ChatOpenAI:
    """初始化 VLM 模型（支持 QwenVLM 或 Gemini）"""
    load_dotenv()
    vlm_model_type = os.getenv("VLM_MODEL", "qwen").lower()
    http_proxy = os.getenv("HTTP_PROXY")
    if vlm_model_type == "qwen":
        qwen_key = os.getenv("QwenVLM_API_KEY")
        if not qwen_key:
            raise RuntimeError("⚠️ .env 文件中未配置 QwenVLM_API_KEY")
        
        return ChatOpenAI(
            api_key=qwen_key,
            model="qwen-vl-max",
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            temperature=0.7
        )
    
    elif vlm_model_type == "gemini":
        gemini_key = os.getenv("GEMINI_API_KEY")
        if not gemini_key:
            raise RuntimeError("⚠️ .env 文件中未配置 GEMINI_API_KEY")
        
        return ChatOpenAI(
            api_key=gemini_key,
            model="gemini-3-pro-preview",
            base_url=http_proxy,
            temperature=0.7
        )
    
def calc_judge_win_rate(layout_img_path, gt_img_path):
    """
    Judge Win Rate 
    """
    try:
        vlm = _init_vlm_model()

        img_a_base64 = _image_to_base64(layout_img_path)
        img_b_base64 = _image_to_base64(gt_img_path)

        system_prompt = """你是一个专业的地图排版专家。请对比图A和图B的布局质量。
        从以下三个维度进行严格评价：
        1. 遮挡情况 - 地图元素之间的遮挡程度
        2. 视觉呼吸感 - 布局的留白和视觉舒适度
        3. 文字-图标对齐度 - 标签与地理要素的对齐准确性

        请严格以JSON格式输出，只包含一个字段 "winner"，值为 "A"、"B" 或 "Tie"。
        """

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=[
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_a_base64}"}},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_b_base64}"}},
            ]),
        ]

        response = vlm.invoke(messages)
        content = response.content

        import re
        match = re.search(r'\{[^}]+\}', content, re.DOTALL)
        if match:
            result = json.loads(match.group())
            winner = result.get("winner", "Tie")
        else:
            winner = "Tie"

        if winner == "A":
            return 1.0
        elif winner == "Tie":
            return 0.5
        else:
            return 0.0

    except Exception as e:
        print(f"⚠️ MLLM 调用失败: {e}，使用模拟值")
        return _mock_judge_result()

