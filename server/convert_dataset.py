"""
数据集转换脚本
将 session/node3 下的所有 GeoJSON 从 GCJ-02 转换为 WGS84，并将 LineString 转换为步行路线
"""
import os
import sys
import json
import math
import requests
from pathlib import Path
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

# 坐标转换常量
PI = math.pi
A = 6378245.0
EE = 0.00669342162296594323

def is_out_of_china(lng, lat):
    return not (73.66 < lng < 135.05 and 3.86 < lat < 53.55)

def gcj02_to_wgs84(gcj_lng, gcj_lat):
    if is_out_of_china(gcj_lng, gcj_lat):
        return (gcj_lng, gcj_lat)
    dlat = _transform_lat(gcj_lng - 105.0, gcj_lat - 35.0)
    dlng = _transform_lng(gcj_lng - 105.0, gcj_lat - 35.0)
    radlat = gcj_lat / 180.0 * PI
    magic = math.sin(radlat)
    magic = 1 - EE * magic * magic
    sqrtmagic = math.sqrt(magic)
    dlat = (dlat * 180.0) / ((A * (1 - EE)) / (magic * sqrtmagic) * PI)
    dlng = (dlng * 180.0) / (A / sqrtmagic * math.cos(radlat) * PI)
    return (gcj_lng - dlng, gcj_lat - dlat)

def _transform_lat(x, y):
    ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * math.sqrt(abs(x))
    ret += (20.0 * math.sin(6.0 * x * PI) + 20.0 * math.sin(2.0 * x * PI)) * 2.0 / 3.0
    ret += (20.0 * math.sin(y * PI) + 40.0 * math.sin(y / 3.0 * PI)) * 2.0 / 3.0
    ret += (160.0 * math.sin(y / 12.0 * PI) + 320 * math.sin(y * PI / 30.0)) * 2.0 / 3.0
    return ret

def _transform_lng(x, y):
    ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * math.sqrt(abs(x))
    ret += (20.0 * math.sin(6.0 * x * PI) + 20.0 * math.sin(2.0 * x * PI)) * 2.0 / 3.0
    ret += (20.0 * math.sin(x * PI) + 40.0 * math.sin(x / 3.0 * PI)) * 2.0 / 3.0
    ret += (150.0 * math.sin(x / 12.0 * PI) + 300.0 * math.sin(x / 30.0 * PI)) * 2.0 / 3.0
    return ret

def convert_coords(coords):
    """递归转换坐标"""
    if isinstance(coords[0], (int, float)):
        return list(gcj02_to_wgs84(coords[0], coords[1]))
    elif isinstance(coords[0], list):
        return [convert_coords(c) for c in coords]
    return coords

def fetch_walking_route(coordinates, token):
    """调用 Mapbox Directions API 获取步行路线"""
    MAX_WAYPOINTS = 5
    
    if len(coordinates) <= 2:
        return coordinates
    
    if len(coordinates) > MAX_WAYPOINTS:
        all_coords = []
        for i in range(len(coordinates) - 1):
            segment = coordinates[i:i+2]
            segment_route = fetch_single_route(segment, token)
            if all_coords:
                all_coords.extend(segment_route[1:])
            else:
                all_coords.extend(segment_route)
        return all_coords
    
    return fetch_single_route(coordinates, token)

def fetch_single_route(coordinates, token):
    """获取单段步行路线"""
    try:
        coords = ';'.join([f"{c[0]},{c[1]}" for c in coordinates])
        url = f"https://api.mapbox.com/directions/v5/mapbox/walking/{coords}?geometries=geojson&access_token={token}"
        
        if len(url) > 2000:
            return coordinates
        
        res = requests.get(url, timeout=15)
        if not res.ok:
            print(f"    ⚠️ Mapbox API error: {res.status}")
            return coordinates
        
        data = res.json()
        route_coords = data.get('routes', [{}])[0].get('geometry', {}).get('coordinates')
        return route_coords if route_coords else coordinates
    except Exception as e:
        print(f"    ⚠️ Mapbox API failed: {e}")
        return coordinates

def process_geojson(geojson_data, style_code=None):
    """处理 GeoJSON：转换坐标并根据 style_code 判断是否获取步行路线"""
    if not geojson_data or 'features' not in geojson_data:
        return geojson_data
    
    processed = json.loads(json.dumps(geojson_data))
    mapbox_token = os.getenv('MAPBOX_TOKEN')
    
    # 从 style_code 中提取 Route 配置，构建 visual_id -> style 映射
    route_style_map = {}
    if style_code and 'Route' in style_code:
        for route_style in style_code['Route']:
            visual_id = route_style.get('visual_id')
            style_type = route_style.get('style')
            if visual_id and style_type:
                route_style_map[visual_id] = style_type
    
    for feature in processed.get('features', []):
        geom_type = feature.get('geometry', {}).get('type')
        coords = feature.get('geometry', {}).get('coordinates')
        if not coords:
            continue
        
        # 转换所有坐标
        feature['geometry']['coordinates'] = convert_coords(coords)
        
        # 处理 LineString 的步行路线
        if geom_type == 'LineString' and mapbox_token:
            visual_id = feature.get('properties', {}).get('visual_id')
            # 只有当 style 为 navigationCurve 时才调用 Mapbox API
            if route_style_map.get(visual_id) == 'navigationCurve':
                original_coords = feature['geometry']['coordinates']
                if len(original_coords) > 2:
                    walking_route = fetch_walking_route(original_coords, mapbox_token)
                    feature['geometry']['coordinates'] = walking_route
        
        # 转换 card_coord 和 label_coord
        props = feature.get('properties', {})
        if 'card_coord' in props and isinstance(props['card_coord'], list):
            props['card_coord'] = list(gcj02_to_wgs84(props['card_coord'][0], props['card_coord'][1]))
        if 'label_coord' in props and isinstance(props['label_coord'], list):
            props['label_coord'] = list(gcj02_to_wgs84(props['label_coord'][0], props['label_coord'][1]))
    
    return processed, 0

def convert_all_sessions(output_dir):
    """转换所有 session 的 GeoJSON"""
    output_path = Path(output_dir)
    if not output_path.exists():
        print(f"❌ Output directory not found: {output_dir}")
        return
    
    sessions = [d for d in output_path.iterdir() if d.is_dir() and 'session' in d.name.lower()]
    print(f"📂 Found {len(sessions)} sessions")
    
    total_files = 0
    
    for session_dir in sorted(sessions):
        node3_dir = session_dir / 'node3'
        node4_dir = session_dir / 'node4'
        if not node3_dir.exists():
            continue
        
        # 读取 style_code
        style_code = None
        if node4_dir.exists():
            style_files = sorted([f for f in node4_dir.glob('*.json')])
            if style_files:
                try:
                    with open(style_files[-1], 'r', encoding='utf-8') as f:
                        style_code = json.load(f)
                except Exception as e:
                    print(f"  ⚠️ Failed to load style from {session_dir.name}: {e}")
        
        geojson_files = list(node3_dir.glob('*.json'))
        if not geojson_files:
            continue
        
        print(f"\n🔄 Processing session: {session_dir.name}")
        
        for geojson_file in geojson_files:
            try:
                with open(geojson_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                processed, _ = process_geojson(data, style_code)
                
                with open(geojson_file, 'w', encoding='utf-8') as f:
                    json.dump(processed, f, ensure_ascii=False, indent=2)
                
                total_files += 1
                print(f"  ✅ {geojson_file.name} converted")
            except Exception as e:
                print(f"  ❌ Failed to process {geojson_file.name}: {e}")
    
    # 转换 mapInfo.json
    for session_dir in sorted(sessions):
        mapinfo_file = session_dir / 'mapInfo.json'
        if mapinfo_file.exists():
            try:
                with open(mapinfo_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                # 转换 center
                if 'center' in data:
                    data['center'] = {
                        'lng': gcj02_to_wgs84(data['center']['lng'], data['center']['lat'])[0],
                        'lat': gcj02_to_wgs84(data['center']['lng'], data['center']['lat'])[1]
                    }
                
                # 转换 bounds
                if 'bounds' in data:
                    nw = gcj02_to_wgs84(data['bounds']['west'], data['bounds']['north'])
                    se = gcj02_to_wgs84(data['bounds']['east'], data['bounds']['south'])
                    data['bounds'] = {
                        'north': nw[1],
                        'south': se[1],
                        'east': se[0],
                        'west': nw[0]
                    }
                
                with open(mapinfo_file, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                
                print(f"  ✅ {session_dir.name}/mapInfo.json converted")
            except Exception as e:
                print(f"  ❌ Failed to process {session_dir.name}/mapInfo.json: {e}")
    
    print(f"\n✅ Conversion complete!")
    print(f"   Total files processed: {total_files}")

def main():
    # 配置
    output_dir = os.path.join(os.path.dirname(__file__), 'output')
    mapbox_token = os.getenv('MAPBOX_TOKEN')
    
    if not mapbox_token:
        print("⚠️ MAPBOX_TOKEN not found in .env file")
        print("   LineString will not be converted to walking routes")
        print("   Add MAPBOX_TOKEN=pk.your_token to server/.env for full conversion")
        print()
    
    print("=" * 60)
    print("🔄 Dataset Conversion Tool")
    print("   GCJ-02 → WGS84")
    if mapbox_token:
        print("   LineString (navigationCurve) → Walking Route")
    print("=" * 60)
    print(f"   Output dir: {output_dir}")
    print()
    
    # 确认执行
    response = input("Continue? (y/N): ")
    if response.lower() != 'y':
        print("Cancelled.")
        return
    
    convert_all_sessions(output_dir)

if __name__ == '__main__':
    main()
