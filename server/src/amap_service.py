"""
高德地图 API 服务
"""
import os
import requests
from typing import Tuple, Optional, Any
from dotenv import load_dotenv
from .utils.coord_transform import is_out_of_china

CHINA_CITY_MARKERS = {
    "中国", "北京", "上海", "天津", "重庆", "广州", "深圳", "杭州", "南京", "苏州", "成都", "西安",
    "武汉", "长沙", "厦门", "青岛", "大连", "宁波", "无锡", "福州", "昆明", "桂林", "拉萨", "香港",
    "澳门", "台北", "三亚", "海口", "黄山", "张家界", "丽江", "大理", "乌鲁木齐", "哈尔滨", "沈阳",
    "长春", "济南", "郑州", "合肥", "南昌", "贵阳", "南宁", "兰州", "银川", "西宁", "呼和浩特",
    "九寨沟", "稻城", "西双版纳", "乌镇", "婺源", "平遥", "敦煌", "嘉峪关", "武夷山", "庐山",
    "神农架", "峨眉山", "乐山", "秦皇岛", "北戴河", "承德", "洛阳", "开封", "扬州", "绍兴",
    "北京市", "上海市", "杭州市", "广州市", "深圳市",
}

FOREIGN_CITY_MARKERS = {
    "新加坡", "singapore", "sentosa",
    "巴黎", "paris", "伦敦", "london", "东京", "tokyo", "大阪", "osaka", "京都", "kyoto",
    "首尔", "seoul", "曼谷", "bangkok", "吉隆坡", "kuala lumpur", "纽约", "new york",
    "洛杉矶", "los angeles", "悉尼", "sydney", "墨尔本", "melbourne", "罗马", "rome",
    "夏威夷", "hawaii", "欧胡", "oahu", "檀香山", "honolulu", "威基基", "waikiki",
    "巴厘", "bali", "普吉", "phuket", "清迈", "chiang mai",
    "美国", "usa", "united states", "韩国", "泰国", "马来西亚", "印尼", "印度尼西亚",
    "越南", "柬埔寨", "澳大利亚", "澳洲", "意大利", "法国", "英国", "德国", "西班牙",
    "葡萄牙", "加拿大",
}

KNOWN_POI_COORDS = {
    "singapore": {
        "福康宁公园": (103.8465, 1.2950),
        "fort canning": (103.8465, 1.2950),
        "鱼尾狮公园": (103.8545, 1.2868),
        "merlion": (103.8545, 1.2868),
        "克拉码头": (103.8465, 1.2906),
        "clarke quay": (103.8465, 1.2906),
        "滨海湾金沙空中花园": (103.8607, 1.2839),
        "金沙空中花园": (103.8607, 1.2839),
        "marina bay sands skypark": (103.8607, 1.2839),
        "skypark": (103.8607, 1.2839),
        "滨海湾金沙": (103.8607, 1.2839),
        "marina bay sands": (103.8607, 1.2839),
        "滨海湾花园": (103.8649, 1.2816),
        "gardens by the bay": (103.8649, 1.2816),
        "圣淘沙": (103.8303, 1.2494),
        "sentosa": (103.8303, 1.2494),
        "新加坡环球影城": (103.8238, 1.2540),
        "环球影城": (103.8238, 1.2540),
        "universal studios": (103.8238, 1.2540),
        "s.e.a.海洋馆": (103.8203, 1.2588),
        "sea aquarium": (103.8203, 1.2588),
        "s.e.a. aquarium": (103.8203, 1.2588),
        "西乐索海滩": (103.8129, 1.2536),
        "siloso beach": (103.8129, 1.2536),
        "唐人街": (103.8439, 1.2836),
        "chinatown": (103.8439, 1.2836),
        "小印度": (103.8520, 1.3067),
        "little india": (103.8520, 1.3067),
        "哈芝巷": (103.8593, 1.3007),
        "haji lane": (103.8593, 1.3007),
        "苏丹回教堂": (103.8590, 1.3023),
        "苏丹清真寺": (103.8590, 1.3023),
        "sultan mosque": (103.8590, 1.3023),
        "新加坡国家博物馆": (103.8488, 1.2966),
        "national museum of singapore": (103.8488, 1.2966),
        "西乐索炮台空中步道": (103.8108, 1.2574),
        "fort siloso skywalk": (103.8108, 1.2574),
        "斯里维拉玛卡里雅曼兴都庙": (103.8521, 1.3065),
        "sri veeramakaliamman": (103.8521, 1.3065),
        "佛牙寺龙华院": (103.8442, 1.2815),
        "buddha tooth relic": (103.8442, 1.2815),
    },
    "hawaii_oahu": {
        "威基基海滩": (-157.8272, 21.2767),
        "waikiki beach": (-157.8272, 21.2767),
        "卡皮欧拉尼公园": (-157.8193, 21.2686),
        "kapiolani park": (-157.8193, 21.2686),
        "钻石头山州立纪念碑": (-157.8059, 21.2620),
        "钻石头山": (-157.8059, 21.2620),
        "diamond head state monument": (-157.8059, 21.2620),
        "diamond head": (-157.8059, 21.2620),
        "珍珠港": (-157.9500, 21.3672),
        "pearl harbor": (-157.9500, 21.3672),
        "伊奥拉尼宫": (-157.8583, 21.3069),
        "iolani palace": (-157.8583, 21.3069),
        "阿拉莫阿那中心": (-157.8430, 21.2910),
        "ala moana center": (-157.8430, 21.2910),
        "恐龙湾": (-157.6938, 21.2690),
        "hanauma bay": (-157.6938, 21.2690),
        "拉尼凯海滩": (-157.7144, 21.3926),
        "lanikai beach": (-157.7144, 21.3926),
        "凯卢阿海滩": (-157.7394, 21.3976),
        "kailua beach": (-157.7394, 21.3976),
        "北岸": (-158.0515, 21.5900),
        "north shore": (-158.0515, 21.5900),
    },
}

class AMapService:
    def __init__(self):
        load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
        load_dotenv(".env")
        self.api_key = os.getenv("AMAP_KEY")
        if not self.api_key:
            raise ValueError("⚠️ .env 文件中未配置 AMAP_KEY")
        self.mapbox_token = (
            os.getenv("MAPBOX_TOKEN")
            or os.getenv("NEXT_PUBLIC_MAPBOX_TOKEN")
            or os.getenv("MAPBOX_ACCESS_TOKEN")
        )

        # 高德地图文本搜索 API URL
        self.base_url_place = "https://restapi.amap.com/v5/place/text"
        # 高德地图输入提示 API URL（用于二次检索）
        self.base_url_tips = "https://restapi.amap.com/v3/assistant/inputtips"
        self.base_url_mapbox = "https://api.mapbox.com/geocoding/v5/mapbox.places"
        
    def geocode_poi(
        self,
        keyword: str,
        city: str = "",
        location: Optional[str] = None,
        search_name_en: Optional[str] = None,
        provider_hint: Optional[str] = None,
    ) -> Optional[dict[str, Any]]:
        """Search a POI and return coordinates plus provenance metadata."""
        keyword = str(keyword or "").strip()
        city = str(city or "").strip()
        provider_hint = str(provider_hint or "").strip().lower()
        city_is_china = bool(city and self._is_china_scope(city))
        city_is_foreign = bool(city and not city_is_china and self._looks_foreign_context(keyword, city, location))
        foreign = not city_is_china and (city_is_foreign or provider_hint == "mapbox" or (
            provider_hint != "amap" and self._looks_foreign_context(keyword, city, location)
        ))

        if foreign:
            query = self._foreign_query(keyword, city, search_name_en)
            result = self._search_mapbox(query, "")
            if result:
                return {
                    "coordinates": list(result),
                    "provider": "mapbox",
                    "query": query,
                    "language": "en",
                    "city": self._english_city_name(city) or city,
                    "source": "mapbox_geocoding",
                    "confidence": "medium",
                    "coordinate_system": "WGS84",
                }

            known = self._lookup_known_poi(keyword, city) or self._lookup_known_poi(search_name_en or "", city)
            if known:
                return {
                    "coordinates": list(known),
                    "provider": "known",
                    "query": query,
                    "language": "en",
                    "city": self._english_city_name(city) or city,
                    "source": "known_poi_fallback",
                    "confidence": "high",
                    "coordinate_system": "WGS84",
                }

            original = self._parse_location(location)
            if original and is_out_of_china(original[0], original[1]):
                print(f"📍 国外 POI 未命中 Mapbox，保留模型坐标: {keyword}")
                return {
                    "coordinates": list(original),
                    "provider": "model",
                    "query": query,
                    "language": "en",
                    "city": self._english_city_name(city) or city,
                    "source": "model_coordinate_fallback",
                    "confidence": "low",
                    "coordinate_system": "WGS84",
                    "warning": "MAPBOX_TOKEN missing or Mapbox returned no result; kept model coordinates.",
                }
            print(f"⚠️ 国外 POI 未命中，跳过高德国内同名兜底: {keyword}")
            return None

        query = keyword
        known = self._lookup_known_poi(keyword, city)
        if known:
            return {
                "coordinates": list(known),
                "provider": "known",
                "query": query,
                "language": "zh",
                "city": city,
                "source": "known_poi_fallback",
                "confidence": "high",
                "coordinate_system": "WGS84",
            }

        result = self._search_poi_primary(keyword, city)
        if result:
            return {
                "coordinates": list(result),
                "provider": "amap",
                "query": query,
                "language": "zh",
                "city": city,
                "source": "amap_place_text",
                "confidence": "medium",
                "coordinate_system": "GCJ-02",
            }

        print(f"📍 一级检索失败，触发二级检索 (inputtips): {keyword}")
        result = self._search_poi_fallback(keyword, city, location)
        if result:
            return {
                "coordinates": list(result),
                "provider": "amap",
                "query": query,
                "language": "zh",
                "city": city,
                "source": "amap_inputtips",
                "confidence": "low",
                "coordinate_system": "GCJ-02",
            }

        print(f"⚠️ POI 检索失败: {keyword}")
        return None

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
        result = self.geocode_poi(keyword, city=city, location=location)
        if not result:
            return None
        coords = result.get("coordinates")
        return tuple(coords) if coords else None
    
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
                    if not self._matches_city_scope(poi, city):
                        continue
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
                    if not self._matches_city_scope(tip, city):
                        continue
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

    def _search_mapbox(self, keyword: str, city: str = "") -> Optional[Tuple[float, float]]:
        """国外 POI 使用 Mapbox Geocoding，返回 WGS84 坐标。中国外坐标后续转换会保持原值。"""
        if not self.mapbox_token:
            return None
        query = f"{keyword}, {city}" if city else keyword
        try:
            response = requests.get(
                f"{self.base_url_mapbox}/{requests.utils.quote(query)}.json",
                params={
                    "access_token": self.mapbox_token,
                    "limit": 1,
                    "language": "en",
                },
                timeout=10,
            )
            data = response.json()
            features = data.get("features") or []
            if features:
                center = features[0].get("center") or []
                if len(center) >= 2:
                    lon, lat = float(center[0]), float(center[1])
                    if is_out_of_china(lon, lat) or not city:
                        return lon, lat
        except Exception as e:
            print(f"Mapbox 国外 POI 检索异常: {e}")
        return None

    def _english_city_name(self, city: str = "") -> str:
        city_text = str(city or "").strip().lower()
        aliases = {
            "新加坡": "Singapore",
            "singapore": "Singapore",
            "巴黎": "Paris",
            "paris": "Paris",
            "伦敦": "London",
            "london": "London",
            "东京": "Tokyo",
            "tokyo": "Tokyo",
            "大阪": "Osaka",
            "osaka": "Osaka",
            "京都": "Kyoto",
            "kyoto": "Kyoto",
            "首尔": "Seoul",
            "seoul": "Seoul",
            "曼谷": "Bangkok",
            "bangkok": "Bangkok",
            "吉隆坡": "Kuala Lumpur",
            "kuala lumpur": "Kuala Lumpur",
            "纽约": "New York",
            "new york": "New York",
            "洛杉矶": "Los Angeles",
            "los angeles": "Los Angeles",
            "悉尼": "Sydney",
            "sydney": "Sydney",
            "墨尔本": "Melbourne",
            "melbourne": "Melbourne",
            "罗马": "Rome",
            "rome": "Rome",
            "夏威夷": "Hawaii",
            "hawaii": "Hawaii",
            "夏威夷欧胡岛": "Oahu, Hawaii",
            "欧胡岛": "Oahu, Hawaii",
            "欧胡": "Oahu, Hawaii",
            "oahu": "Oahu, Hawaii",
            "檀香山": "Honolulu, Hawaii",
            "honolulu": "Honolulu, Hawaii",
            "巴厘岛": "Bali",
            "巴厘": "Bali",
            "bali": "Bali",
            "普吉岛": "Phuket",
            "普吉": "Phuket",
            "phuket": "Phuket",
        }
        return aliases.get(city_text, str(city or ""))

    def _english_known_alias(self, keyword: str = "", city: str = "") -> str:
        city_key = self._known_city_key(city, keyword)
        if not city_key:
            return ""
        query = str(keyword or "").lower().replace(" ", "")
        known = KNOWN_POI_COORDS.get(city_key, {})
        matched_coords = None
        for alias, coords in known.items():
            alias_key = alias.lower().replace(" ", "")
            if alias_key and alias_key in query:
                if any(("a" <= char.lower() <= "z") for char in alias):
                    return alias
                matched_coords = coords
                break
        if matched_coords:
            for alias, coords in known.items():
                if coords == matched_coords and any(("a" <= char.lower() <= "z") for char in alias):
                    return alias
        return ""

    def _foreign_query(self, keyword: str, city: str = "", search_name_en: Optional[str] = None) -> str:
        city_en = self._english_city_name(city)
        name = str(search_name_en or "").strip() or self._english_known_alias(keyword, city) or str(keyword or "").strip()
        if city_en and city_en.lower() not in name.lower():
            return f"{name}, {city_en}"
        return name

    def _parse_location(self, location: Optional[str]) -> Optional[Tuple[float, float]]:
        if not location:
            return None
        try:
            lon_text, lat_text = str(location).split(",", 1)
            return float(lon_text), float(lat_text)
        except (ValueError, AttributeError):
            return None

    def _looks_foreign_context(self, keyword: str, city: str = "", location: Optional[str] = None) -> bool:
        city_text = str(city or "").strip()
        if city_text and self._is_china_scope(city_text):
            return False
        if self._has_foreign_marker(city_text) or self._has_foreign_marker(keyword):
            return True
        if city_text and not self._is_china_scope(city_text):
            return True
        original = self._parse_location(location)
        if original and is_out_of_china(original[0], original[1]):
            return True
        query_text = f"{keyword} {city_text}".strip()
        has_cjk = any("\u4e00" <= char <= "\u9fff" for char in query_text)
        has_latin = any(("a" <= char.lower() <= "z") for char in query_text)
        return bool(city_text and has_latin and not has_cjk)

    def _is_china_scope(self, text: str) -> bool:
        compact = str(text or "").replace(" ", "")
        if not compact:
            return False
        if self._has_foreign_marker(compact):
            return False
        if any(marker in compact for marker in CHINA_CITY_MARKERS):
            return True
        if any(suffix in compact for suffix in ("市", "省", "自治区", "自治州", "地区", "盟")):
            return True
        has_cjk = any("\u4e00" <= char <= "\u9fff" for char in compact)
        has_latin = any(("a" <= char.lower() <= "z") for char in compact)
        return has_cjk and not has_latin and any(marker in compact for marker in ("中国", "中华", "大陆", "内地"))

    def _matches_city_scope(self, item: dict, city: str = "") -> bool:
        city_text = str(city or "").strip()
        if not city_text:
            return True
        if not self._is_china_scope(city_text):
            return False
        city_token = city_text.replace("市", "").replace("省", "").replace("特别行政区", "")
        haystack = "".join(
            str(item.get(key) or "")
            for key in ["pname", "cityname", "adname", "district", "address", "name"]
        )
        return city_token in haystack or city_text in haystack

    def _has_foreign_marker(self, text: str) -> bool:
        compact = str(text or "").strip().lower()
        return any(marker in compact for marker in FOREIGN_CITY_MARKERS)

    def _known_city_key(self, city: str = "", keyword: str = "") -> Optional[str]:
        text = f"{city} {keyword}".lower()
        if "新加坡" in text or "singapore" in text or "sentosa" in text:
            return "singapore"
        if any(marker in text for marker in ["夏威夷", "hawaii", "欧胡", "oahu", "檀香山", "honolulu", "威基基", "waikiki"]):
            return "hawaii_oahu"
        return None

    def _lookup_known_poi(self, keyword: str, city: str = "") -> Optional[Tuple[float, float]]:
        city_key = self._known_city_key(city, keyword)
        if not city_key:
            return None
        query = str(keyword or "").lower().replace(" ", "")
        for alias, coords in KNOWN_POI_COORDS.get(city_key, {}).items():
            alias_key = alias.lower().replace(" ", "")
            if alias_key and alias_key in query:
                return coords
        return None
