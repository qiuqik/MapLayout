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
        self.base_url_place = "https://restapi.amap.com/v5/place/text"
        # 高德地图输入提示 API URL（用于二次检索）
        self.base_url_tips = "https://restapi.amap.com/v3/assistant/inputtips"
        
    def search_poi(self, keyword: str, city: str = "", location: Optional[str] = None) -> Optional[Tuple[float, float]]:
        """
        根据关键字搜索 POI，返回高德 GCJ-02 坐标 (longitude, latitude)。
        如果第一次搜索失败，使用 inputtips API 进行二次检索。
        如果仍未找到，则返回 None。
        
        Args:
            keyword: 搜索关键词
            city: 城市（可选）
            location: 中心点坐标，格式为 "longitude,latitude"（可选）
            
        Returns:
            (longitude, latitude) 或 None
        """
        # 第一次尝试：使用文本搜索 API
        result = self._search_poi_primary(keyword, city)
        if result:
            return result
        
        # 二次检索：使用 inputtips API
        print(f"📍 一级检索失败，触发二级检索 (inputtips): {keyword}")
        result = self._search_poi_fallback(keyword, city, location)
        if result:
            return result
        
        print(f"⚠️ POI 检索失败: {keyword}")
        return None
    
    def _search_poi_primary(self, keyword: str, city: str = "") -> Optional[Tuple[float, float]]:
        """第一级检索：使用文本搜索 API (v5/place/text)"""
        params = {
            "key": self.api_key,
            "keywords": keyword
        }
        if city:
            params["city"] = city
            
        try:
            response = requests.get(self.base_url_place, params=params, timeout=10)
            data = response.json()
            
            # 高德 API 成功状态码为 "1" 检查是否有返回 pois 数据
            if data.get("status") == "1" and data.get("pois"):
                # 从前往后提取前三个结果，只要出现location则检索成功
                pois_list = data.get("pois", [])
                for poi in pois_list[:3]:  # 只检查前3个结果
                    location = poi.get("location")
                    if location:
                        lon, lat = map(float, location.split(","))
                        return lon, lat
        except Exception as e:
            print(f"一级检索异常 (v5/place/text): {e}")
            
        return None
    
    def _search_poi_fallback(self, keyword: str, city: str = "", location: Optional[str] = None) -> Optional[Tuple[float, float]]:
        """二级检索：使用输入提示 API (v3/assistant/inputtips)"""
        params = {
            "key": self.api_key,
            "keywords": keyword
        }
        
        # 如果提供了城市，添加到请求参数
        if city:
            params["city"] = city
        
        # 如果提供了中心坐标，添加到请求参数
        if location:
            params["location"] = location
            
        try:
            response = requests.get(self.base_url_tips, params=params, timeout=10)
            data = response.json()
            
            # 状态码为 "1" 表示成功，tips 包含建议列表
            if data.get("status") == "1" and data.get("tips"):
                # 从前往后提取前三个结果，只要出现location则检索成功
                tips_list = data.get("tips", [])
                for tip in tips_list[:3]:  # 只检查前3个结果
                    location_str = tip.get("location")
                    if location_str:
                        try:
                            lon, lat = map(float, location_str.split(","))
                            return lon, lat
                        except (ValueError, AttributeError):
                            continue
        except Exception as e:
            print(f"二级检索异常 (v3/assistant/inputtips): {e}")
            
        return None