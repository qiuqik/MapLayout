import os
from openai import OpenAI
from dotenv import load_dotenv
import json
import base64
from datetime import datetime


class VLMAgent:
    def __init__(self):
        load_dotenv(".env")
        self.vlm_key = os.getenv("QwenVLM_API_KEY")
        if not self.vlm_key:
            raise RuntimeError("⚠️ .env 文件中未配置 QwenVLM_API_KEY")
        
        self.client = OpenAI(
            api_key=self.vlm_key,
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        )
        
        self.output_dir = os.path.join(os.path.dirname(__file__), 'output/stylejson')
    
    

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
        核心方法：调用VLM模型分析图片，返回Mapbox样式JSON字符串

        image_url: 可访问的图片 URL
        返回：模型返回内容（string 格式，期望为 mapbox 风格 JSON）
        """
        prompt = (
            "你是一个地图规划设计师，你需要从用户给定的的旅游规划图提取以下元素："
            "背景主色调、判断是否需要底层地图、坐标点 icon、路线样式（颜色、宽度、直/弯等）、"
            "卡片样式（颜色、边框、字体颜色、字体样式）、坐标点与卡片之间连线样式（单箭头/直线/曲线）\n"
            "请以 mapbox 样式 json 文件格式输出。"
        )
        
        try:
            image_base64 = self.image_to_base64(image_path)
            client = self._get_client()
            completion = client.chat.completions.create(
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
                max_tokens=2000,
                temperature=0.1,
                response_format={"type": "json_object"}
            )

            content = completion.choices[0].message.content.strip()
            json.loads(content)
            return content
        except json.JSONDecodeError:
            raise ValueError("模型返回内容不是有效的JSON格式，请检查prompt或模型响应")
        except Exception as e:
            raise RuntimeError(f"调用VLM模型失败：{str(e)}")
    
    
    def save_result(self, json_content: str) -> str:
        """
        将JSON内容保存到output/stylejson目录，文件名带时间戳
        
        :param json_content: 要保存的JSON字符串
        :return: 保存的文件完整路径
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
