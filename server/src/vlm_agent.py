import os
from openai import OpenAI
from dotenv import load_dotenv
import json
import base64
from datetime import datetime


class VLMAgent:
    def __init__(self, output_dir):
        load_dotenv(".env")
        self.vlm_key = os.getenv("QwenVLM_API_KEY")
        if not self.vlm_key:
            raise RuntimeError("⚠️ .env 文件中未配置 QwenVLM_API_KEY")
        
        self.client = OpenAI(
            api_key=self.vlm_key,
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        )
        
        self.output_dir = output_dir
    

    def image_to_base64(self, image_path: str) -> str:
        # 读取图片格式
        ext = os.path.splitext(image_path)[1].lower().lstrip('.')
        if ext not in ["jpg", "jpeg", "png", "gif", "bmp"]:
            raise ValueError(f"不支持的图片格式：{ext}，仅支持 jpg/jpeg/png/gif/bmp")
        
        # Base64
        with open(image_path, "rb") as f:
            base64_data = base64.b64encode(f.read()).decode("utf-8")
        
        return f"data:image/{ext};base64,{base64_data}"

    def analyze_image(self, image_path: str) -> str:
        """
        核心方法：调用VLM模型分析图片，返回严格遵循规定的 Mapbox 样式JSON字符串
        """
        prompt = """你是一个专业的地图规划设计师和前端开发工程师。你需要仔细观察用户给定的旅游规划图，并提取样式特征。
请务必按照以下 JSON 格式返回结果，严格遵守给定的键名和可选的数值或枚举值：

{
  "mapConfig": {
    "BaseMap": "枚举值：必须从 'blank'、'standard'、'satellite' 中选择",
    "backgroundColor": "十六进制颜色码，如 '#f8fafc'，仅在 BaseMap 为 'blank' 时生效"
  },
  "routes": {
    "color": "路线的十六进制颜色码，如 '#f97316'", 
    "width": "路线宽度的数字，如 4",
    "lineStatus": "枚举值：必须从 'StraightLine' 或 'NavigationCurve' 中选择" 
  },
  "points": {
    "type": "枚举值：必须从 'default-marker' 或 'div-svg' 中选择",
    "color": "途径点的十六进制颜色码，如 '#ea580c'",
    "svg": "如果 type 是 'div-svg'，请根据图片中的POI 坐标点的图标风格生成对应的 svg 代码；如果是 'default-marker'，请填 'none'"
  },
  "connectLine": {
    "color": "信息卡片与坐标点之间连线的十六进制颜色码",
    "type": "枚举值：必须从 'straight' 或 'SmoothCurve' 中选择", 
    "arrow": "枚举值：必须从 'Point2Card'、'Card2Point'、'none' 中选择"
  },
  "card": {
    "borderColor": "卡片边框的十六进制颜色码，如果没有边框请填 'none'",
    "backgroundColor": "卡片背景的十六进制颜色码",
    "textColor": "卡片字体的十六进制颜色码",
    "title": "布尔值(true/false)，图中卡片是否显示标题",
    "category": "布尔值(true/false)，图中卡片是否显示分类信息",
    "rating": "布尔值(true/false)，图中卡片是否显示评分",
    "desc": "布尔值(true/false)，图中卡片是否显示描述内容",
    "tags": "布尔值(true/false)，图中卡片是否显示标签",
    "chart": "布尔值(true/false)，图中卡片是否显示图表",
    "address": "布尔值(true/false)，图中卡片是否显示地址",
    "openTime": "布尔值(true/false)，图中卡片是否显示开放时间",
    "ticketPrice": "布尔值(true/false)，图中卡片是否显示门票价格"
  }
}

注意：只返回标准的 JSON 格式对象，不要包含多余的 markdown 代码块标识（如 ```json）或任何说明性文字。布尔值请直接使用小写的 true 或 false。
"""
        
        try:
            image_base64 = self.image_to_base64(image_path)
            completion = self.client.chat.completions.create(
                model="qwen3-vl-plus",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": image_base64}},
                            {"type": "text", "text": prompt},
                        ],
                    }
                ],
                # 输出 JSON
                response_format={"type": "json_object"}
            )

            content = completion.choices[0].message.content.strip()
            
            if content.startswith("```json"):
                content = content[7:]
            if content.startswith("```"):
                content = content[3:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()

            json.loads(content)
            return content
        except json.JSONDecodeError as e:
            raise ValueError(f"模型返回内容不是有效的JSON格式: {str(e)} \n返回内容: {content}")
        except Exception as e:
            raise RuntimeError(f"调用VLM模型失败：{str(e)}")
    
    
    def save_result(self, json_content: str) -> str:
        """
        将JSON内容保存到output/stylejson目录，文件名带时间戳
        """
        os.makedirs(self.output_dir, exist_ok=True)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_name = f"mapbox_style_{timestamp}.json"
        out_path = os.path.join(self.output_dir, out_name)

        try:
            json_data = json.loads(json_content)
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(json_data, f, ensure_ascii=False, indent=2)
            print(f"✅ 结果已成功保存到：{out_path}")
            return out_path
        except Exception as e:
            raise RuntimeError(f"保存文件失败：{str(e)}")

