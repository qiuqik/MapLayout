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
        ext = os.path.splitext(image_path)[1].lower().lstrip('.')
        if ext not in ["jpg", "jpeg", "png", "gif", "bmp"]:
            raise ValueError(f"不支持的图片格式：{ext}，仅支持 jpg/jpeg/png/gif/bmp")
        
        with open(image_path, "rb") as f:
            base64_data = base64.b64encode(f.read()).decode("utf-8")
        
        return f"data:image/{ext};base64,{base64_data}"

    def analyze_image(self, image_path: str) -> str:
        """
        核心方法：调用VLM模型分析图片，返回严格遵循规定的 Mapbox 样式JSON字符串
        """
        prompt = """你是一个专业的地图规划设计师和资深前端(React)开发工程师。你需要仔细观察用户给定的旅游规划图，提取样式特征并按要求结构化输出。

对于底图和路线等 Mapbox 渲染部分，请提供基础配置；
对于卡片(card)部分，请直接输出符合 React 行内样式（React Inline Style）规范的 JSON 对象（驼峰命名，如 backgroundColor, fontSize, borderRadius 等），你可以根据图中的设计自由推测并添加各种 CSS 属性以求最高程度还原图片。

请务必按照以下 JSON 格式返回结果：

{
  "mapConfig": {
    "baseMap": "枚举值：必须从 'blank'、'standard'、'satellite' 中选择",
    "backgroundColor": "十六进制颜色码，仅在 baseMap 为 'blank' 时生效"
  },
  "route": {
    "color": "路线的十六进制颜色码", 
    "width": "路线宽度的数字",
    "style": "枚举值：'straightLine' 或 'navigationCurve'" 
  },
  "point": {
    "type": "枚举值：'default' 或 'svg'",
    "color": "途径点的十六进制颜色码",
    "iconSvg": "如果 type 是 'svg'，请生成对应的 svg 代码；否则填 'none'"
  },
  "connectLine": {
    "color": "连线的十六进制颜色码",
    "type": "枚举值：'straight' 或 'curve'", 
    "arrowDirection": "枚举值：'none'、'point-to-card'、'card-to-point'"
  },
  "card": {
    "containerStyle": {
      "backgroundColor": "推测的背景色",
      "borderRadius": "推测的圆角大小",
      "boxShadow": "推测的阴影",
      "padding": "推测的内边距",
      "border": "推测的边框",
      "opacity": "透明度(数字)"
      // 你可以自由添加更多 React 样式属性以还原图片中的卡片容器样式
    },
    "elements": {
      "title": { 
        "show": true, //是否展示标题
        "style": {"backgroundColor": "...", "color": "#...", "fontSize": "...", "fontWeight": "..." /* 自由添加 */ }
      },
      "desc": { 
        "show": true, //是否展示描述
        "style": { "color": "#...", "fontSize": "...", "lineHeight": "..." /* 自由添加 */ }
      },
      "tags": { 
        "show": true, //是否展示标签
        "containerStyle": { "display": "flex", "gap": "..." /* 标签容器样式 */ },
        "itemStyle": { "color": "#...", "backgroundColor": "#...", "borderRadius": "..." /* 单个标签样式 */ }
      },
      "category": { "show": false, "style": {} },
      "rating": { "show": false, "style": {} },
      "address": { "show": false, "style": {} },
      "openTime": { "show": false, "style": {} },
      "ticketPrice": { "show": false, "style": {} },
      "chart": { "show": false, "style": {} }
    }
  }
}

注意：
1. 请仔细观察图片中卡片的排版和颜色，让生成的 style 对象尽可能美观且接近原图。
2. 只返回标准的 JSON 格式对象，不要包含多余的 markdown 代码块标识（如 ```json）或任何说明文字。
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
                response_format={"type": "json_object"}
            )

            content = completion.choices[0].message.content.strip()
            
            # 清理多余内容
            if content.startswith("```json"):
                content = content[7:]
            if content.startswith("```"):
                content = content[3:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()

            json.loads(content) # 校验
            return content
        except json.JSONDecodeError as e:
            raise ValueError(f"模型返回内容不是有效的JSON格式: {str(e)} \n返回内容: {content}")
        except Exception as e:
            raise RuntimeError(f"调用VLM模型失败：{str(e)}")
    
    
    def save_result(self, json_content: str) -> str:
        os.makedirs(self.output_dir, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_name = f"mapbox_style_{timestamp}.json"
        out_path = os.path.join(self.output_dir, out_name)

        try:
            json_data = json.loads(json_content)
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(json_data, f, ensure_ascii=False, indent=2)
            print(f"✅ 结果已成功保存到：{out_path}")
            return out_name
        except Exception as e:
            raise RuntimeError(f"保存文件失败：{str(e)}")