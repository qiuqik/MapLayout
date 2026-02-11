"""
坐标转换
GCJ-02(火星坐标系) -- WGS84(地球坐标系)
高德地图 -- Mapbox
"""
import math

# 定义坐标系转换的常量
PI = math.pi
A = 6378245.0  # 长半轴
EE = 0.00669342162296594323  # 偏心率平方

def is_out_of_china(lng, lat):
    """
    判断坐标是否在国内，不在国内则不做偏移修正
    :param lng: 经度
    :param lat: 纬度
    :return: True/False
    """
    return not (73.66 < lng < 135.05 and 3.86 < lat < 53.55)

def gcj02_to_wgs84(gcj_lng, gcj_lat):
    """
    GCJ-02(高德) 转 WGS84(Mapbox)
    :param gcj_lng: 高德经度
    :param gcj_lat: 高德纬度
    :return: (wgs84_lng, wgs84_lat)
    """
    # 非中国境内坐标直接返回原坐标
    if is_out_of_china(gcj_lng, gcj_lat):
        return (gcj_lng, gcj_lat)
    
    # 计算偏移量
    dlat = _transform_lat(gcj_lng - 105.0, gcj_lat - 35.0)
    dlng = _transform_lng(gcj_lng - 105.0, gcj_lat - 35.0)
    radlat = gcj_lat / 180.0 * PI
    magic = math.sin(radlat)
    magic = 1 - EE * magic * magic
    sqrtmagic = math.sqrt(magic)
    dlat = (dlat * 180.0) / ((A * (1 - EE)) / (magic * sqrtmagic) * PI)
    dlng = (dlng * 180.0) / (A / sqrtmagic * math.cos(radlat) * PI)
    
    # 还原WGS84坐标
    wgs84_lat = gcj_lat - dlat
    wgs84_lng = gcj_lng - dlng
    
    return (wgs84_lng, wgs84_lat)

def _transform_lat(x, y):
    """辅助计算纬度偏移量"""
    ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * math.sqrt(abs(x))
    ret += (20.0 * math.sin(6.0 * x * PI) + 20.0 * math.sin(2.0 * x * PI)) * 2.0 / 3.0
    ret += (20.0 * math.sin(y * PI) + 40.0 * math.sin(y / 3.0 * PI)) * 2.0 / 3.0
    ret += (160.0 * math.sin(y / 12.0 * PI) + 320 * math.sin(y * PI / 30.0)) * 2.0 / 3.0
    return ret

def _transform_lng(x, y):
    """辅助计算经度偏移量"""
    ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * math.sqrt(abs(x))
    ret += (20.0 * math.sin(6.0 * x * PI) + 20.0 * math.sin(2.0 * x * PI)) * 2.0 / 3.0
    ret += (20.0 * math.sin(x * PI) + 40.0 * math.sin(x / 3.0 * PI)) * 2.0 / 3.0
    ret += (150.0 * math.sin(x / 12.0 * PI) + 300.0 * math.sin(x / 30.0 * PI)) * 2.0 / 3.0
    return ret