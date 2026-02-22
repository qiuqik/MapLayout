"""
高德地图 API 服务
"""
import os
import requests
from typing import Tuple, Optional
from dotenv import load_dotenv

class AMapService:
    def __init__(self):
        load_dotenv(".env")
        self.api_key = os.getenv("AMAP_KEY")
        if not self.api_key:
            raise ValueError("⚠️ .env 文件中未配置 AMAP_KEY")
        
        # 高德地图文本搜索 API URL
        self.base_url = "https://restapi.amap.com/v5/place/text"
        
    def search_poi(self, keyword: str, city: str = "") -> Optional[Tuple[float, float]]:
        """
        根据关键字搜索 POI，返回高德 GCJ-02 坐标 (longitude, latitude)。
        如果未找到，则返回 None。
        """
        params = {
            "key": self.api_key,
            "keywords": keyword
        }
        if city:
            params["city"] = city
            
        try:
            response = requests.get(self.base_url, params=params, timeout=10)
            data = response.json()
            
            # 高德 API 成功状态码为 "1" 检查是否有返回 pois 数据
            if data.get("status") == "1" and data.get("pois"):
                poi = data["pois"][0]
                location = poi.get("location")
                if location:
                    lon, lat = map(float, location.split(","))
                    return lon, lat
        except Exception as e:
            print(f"高德地图 API 请求异常: {e}")
            
        return None