import os
import sys
import json
import time
import argparse
import csv
import math
from pathlib import Path

EVALUATE_DIR = Path(__file__).parent
RESULT_DIR = EVALUATE_DIR / "result"
DEFAULT_SESSION = "20260413_130909_session_1776056949"

IMG_WIDTH = 1500
IMG_HEIGHT = 900

METRIC_CONFIGS = {
    "Overlap": {
        "description": "布局重叠度，越小越好",
        "direction": "lower",
    },
    "Utility": {
        "description": "空间利用率，越大越好",
        "direction": "higher",
    },
    "Balance": {
        "description": "空间平衡性，越大越好",
        "direction": "higher",
    },
    "MeanIoU": {
        "description": "与 GT 相似性，越大越好",
        "direction": "higher",
    },
    "Aesthetics": {
        "description": "美观性，1.0=胜, 0.5=平局, 0.0=负",
        "direction": "higher",
    },
    "Stability": {
        "description": "算法稳定性，多次运行结果的平均两两 IoU，越大越好",
        "direction": "higher",
    },
    "MeanTime": {
        "description": "算法平均耗时，多次运行结果的平均时间，越小越好",
        "direction": "lower",
    },
}

def _mean(values):
    return sum(values) / len(values) if values else None


def _std(values):
    if not values:
        return None
    mean_value = _mean(values)
    return math.sqrt(sum((v - mean_value) ** 2 for v in values) / len(values))


def calc_overlap(bbox_elements, geometries) -> dict:
    """
    指标 1: 布局重叠度 (Ove ↓)
    计算标签与标签之间、标签与地理要素(点线面)之间的遮挡程度
    正确方法：对每个标签，找出所有与其相交的对象，将它们合并(Union)成一个几何体，
    再计算该合并几何体与当前标签的相交面积，绝对避免重复计算。
    """
    bboxes = list(bbox_elements.values())
    if not bboxes: 
        return {"value": 0.0, "description": "布局重叠度，越小越好"}
    
    total_label_area = sum([b.area for b in bboxes])
    if total_label_area == 0:
        return {"value": 0.0, "description": "布局重叠度，越小越好"}

    from shapely.ops import unary_union

    total_covered_area = 0.0
    
    # 对每个标签单独计算它被遮挡的真实物理面积
    for i, label_bbox in enumerate(bboxes):
        # 收集所有可能会遮挡当前标签的“障碍物”
        obstacles = []
        
        # 1. 寻找与其重叠的其他标签
        for j, other_bbox in enumerate(bboxes):
            if i != j and label_bbox.intersects(other_bbox):
                obstacles.append(other_bbox)
        
        # 2. 寻找与其重叠的地理要素
        for bg_geom in geometries:
            if label_bbox.intersects(bg_geom):
                obstacles.append(bg_geom)
        
        # 如果有遮挡物，计算真实的遮挡面积
        if obstacles:
            # 核心修复：使用 unary_union 将所有障碍物在空间上融合成一个多边形
            # 这样就算 100 个要素压在同一个像素上，也只算作一层遮挡
            merged_obstacles = unary_union(obstacles)
            
            # 计算合并后的障碍物与当前标签的相交面积
            actual_covered_area = label_bbox.intersection(merged_obstacles).area
            total_covered_area += actual_covered_area

    # 重叠度 = 真实被覆盖的总面积 / 标签总面积
    overlap = total_covered_area / total_label_area
    
    # 限制在 [0, 1] 范围内 (作为安全兜底，理论上正常算出来绝对不会超过1)
    overlap = min(1.0, overlap)
    
    result = {
        "value": float(round(overlap, 4)),
        "description": "布局重叠度，越小越好"
    }
    return result
def calc_utility(bbox_elements, mask):
    """
    指标 2: 空间利用率 (Uti ↑) 
    基于显著性图计算，分解区域，每个区域是否有内容占用，占用率为空间利用率
    """
    import numpy as np

    img_height = IMG_HEIGHT
    img_width = IMG_WIDTH
    
    # 网格配置：分解为 15*9 的区域
    grid_rows = 6
    grid_cols = 10
    cell_height = img_height // grid_rows
    cell_width = img_width // grid_cols
    
    # 统计有占用的网格数
    occupied_cells = 0
    for i in range(grid_rows):
        for j in range(grid_cols):
            y_start = i * cell_height
            y_end = (i + 1) * cell_height
            x_start = j * cell_width
            x_end = (j + 1) * cell_width
            
            # 检查这个网格内是否有内容占用 (mask 中 255 表示有占用)
            cell_mask = mask[y_start:y_end, x_start:x_end]
            if np.any(cell_mask > 0):
                occupied_cells += 1
    
    # 利用率 = 有占用的网格数 / 总网格数
    utility = occupied_cells / (grid_rows * grid_cols)
    
    result = {
        "value": float(round(utility, 4)),
        "description": METRIC_CONFIGS["Utility"]["description"]
    }
    return result
def calc_balance(bbox_elements, mask):
    """
    指标 3: 空间平衡性 (Bal ↑)
    大面积留白或小区域过度密集会降低空间平衡性
    基于显著性图计算，分解区域，每个网格内占用像素比例，计算这些网格密度的标准差
    """
    import numpy as np

    img_height = IMG_HEIGHT
    img_width = IMG_WIDTH
    
    # 网格配置：分解为 3*5 的区域
    grid_rows = 3
    grid_cols = 5
    cell_height = img_height // grid_rows
    cell_width = img_width // grid_cols
    cell_pixels = cell_height * cell_width
    
    # 计算每个网格的占用像素比例（密度）
    densities = []
    for i in range(grid_rows):
        for j in range(grid_cols):
            y_start = i * cell_height
            y_end = (i + 1) * cell_height
            x_start = j * cell_width
            x_end = (j + 1) * cell_width
            
            # 提取网格
            cell_mask = mask[y_start:y_end, x_start:x_end]
            # 计算占用像素数（mask 中 > 0 表示有占用）
            occupied_pixels = np.count_nonzero(cell_mask)
            # 归一化为 [0, 1] 的密度
            density = occupied_pixels / cell_pixels
            
            densities.append(density)
    # 计算网格密度的标准差
    std_dev = float(_std(densities) or 0.0)
    
    # 将标准差转换为平衡性分数（标准差越小，分数越高）
    # 使用公式：balance = 1 / (1 + std_dev)
    # 这样 std_dev=0 时 balance=1.0，std_dev 增大时 balance 缓慢下降
    # balance = 1.0 / (1.0 + std_dev)
    balance = max(0.0, 1.0 - (std_dev / 0.5))
    # import math
    # balance = math.exp(-5.0 * std_dev)
    result = {
        "value": float(round(balance, 4)),
        "description": METRIC_CONFIGS["Balance"]["description"]
    }
    return result
def calc_mean_iou(a_bbox, b_bbox):
    """
    指标 4: 与 GT 的平均空间相似性 (Mean Spatial Sim ↑)
    替代传统 IoU，结合了“中心点距离相似性”和“面积/形状相似性”。
    即使两个元素没有重叠，只要它们离得近且大小相似，依然能得到较高的分数。
    """
    if not a_bbox and not b_bbox:
        return {
            "value": 0.0, 
            "description": "与 GT 的平均相似性(含距离容忍)，越大越好"
        }
        
    similarities = []
    
    # 取并集，确保多生成的和漏生成的都能被惩罚 (未匹配到的算 0 分)
    all_keys = set(a_bbox.keys()).union(set(b_bbox.keys()))
    
    # 距离容忍度参数 sigma (单位: 像素)。
    # 对于 1500*900 的画布，100 是一个非常符合人类视觉的宽容度。
    sigma = 100.0 
    
    for key in all_keys:
        pred_poly = a_bbox.get(key)
        gt_poly = b_bbox.get(key)
        
        # 惩罚项：如果只存在于一侧，说明漏生成或多生成，相似度为 0
        if pred_poly is None or gt_poly is None:
            similarities.append(0.0)
            continue
            
        try:
            # 1. 计算中心点距离
            dist = pred_poly.centroid.distance(gt_poly.centroid)
            
            # 2. 位置相似性 (高斯衰减映射)
            # 公式: exp(- d^2 / 2*sigma^2)
            # 距离 0px -> 1.0 | 距离 50px -> 0.88 | 距离 100px -> 0.60 | 距离 200px -> 0.13
            pos_sim = math.exp(-(dist ** 2) / (2 * sigma ** 2))
            
            # 3. 面积相似性 (保证元素不仅位置对，大小也要差不多)
            area_pred = pred_poly.area
            area_gt = gt_poly.area
            if area_pred > 0 and area_gt > 0:
                area_sim = min(area_pred, area_gt) / max(area_pred, area_gt)
            else:
                area_sim = 0.0
                
            # 4. 综合该元素的相似性得分
            sim = pos_sim * area_sim
            similarities.append(sim)
            
        except Exception as e:
            print(f"警告: 计算 {key} 的相似性时发生错误 - {e}")
            similarities.append(0.0)
            
    # 计算所有元素的平均相似性
    mean_sim = sum(similarities) / len(similarities) if len(similarities) > 0 else 0.0
    
    result = {
        "value": float(round(mean_sim, 4)),
        "description": "与 GT 的平均相似性(含距离容忍)，越大越好"
    }
    
    return result

def calc_aesthetics(a_pth, b_pth):
    """
    指标 5: 计算美观性（Judge Win Rate）
    """
    from vllm import calc_judge_win_rate

    value = calc_judge_win_rate(a_pth, b_pth)
    result = {
        "value": value,
        "description": METRIC_CONFIGS["Aesthetics"]["description"]
    }
    return result
def calc_stability(bbox_elements_list):
    """
    指标 6: layout 算法稳定性
    """
    if len(bbox_elements_list) < 2:
        return {
            "value": None,
            "description": METRIC_CONFIGS["Stability"]["description"]
        }

    ious = []
    for i in range(len(bbox_elements_list)):
        for j in range(i + 1, len(bbox_elements_list)):
            mean_iou = calc_mean_iou(bbox_elements_list[i], bbox_elements_list[j])
            ious.append(mean_iou["value"])
    
    value = float(_mean(ious)) if ious else None
    result = {
        "value": float(round(value, 4)) if value is not None else None,
        "description": METRIC_CONFIGS["Stability"]["description"]
    }
    return result
def calc_mean_time(runtime_values=None):
    """
    指标 7: layout 算法平均耗时
    """
    runtime_values = [v for v in (runtime_values or []) if isinstance(v, (int, float))]
    value = float(_mean(runtime_values)) if runtime_values else None
    result = {
        "value": float(round(value, 4)) if value is not None else None,
        "description": METRIC_CONFIGS["MeanTime"]["description"]
    }
    return result



class Session:
    def __init__(self, session_name):
        self.img_width = IMG_WIDTH
        self.img_height = IMG_HEIGHT

        self.session_name = session_name
        self.session_path = EVALUATE_DIR / self.session_name
        if not self.session_path.exists():
            raise FileNotFoundError(f"Session 不存在: {self.session_name}")
        
        #  解析地图边界
        map_info_path = self.session_path / "mapInfo.json"
        if not map_info_path.exists():
            raise FileNotFoundError(f"缺少 mapInfo.json: {self.session_name}")
        with open(map_info_path, 'r', encoding='utf-8') as f:
            map_info = json.load(f)
            self.bounds = map_info['bounds']

        self.output_dir = self.session_path / "output"
        self.output_dir.mkdir(exist_ok=True)

        # 解析 geojson
        node3_dir = self.session_path / "node3"
        if not node3_dir.exists():
            raise FileNotFoundError(f"缺少 node3 目录: {self.session_name}")
        origin_candidates = list(node3_dir.glob(f"*origin*.json"))
        self.layout_candidates = list(node3_dir.glob(f"*layout*.json"))
        gt_candidates = list(node3_dir.glob(f"*groundtruth*.json"))
        if not origin_candidates:
            raise FileNotFoundError(f"缺少 origin GeoJSON: {self.session_name}")
        if not self.layout_candidates:
            raise FileNotFoundError(f"缺少 layout GeoJSON: {self.session_name}")
        if not gt_candidates:
            raise FileNotFoundError(f"缺少 groundtruth GeoJSON: {self.session_name}")
        # 按照创建时间排序
        origin_candidates.sort(key=lambda x: x.stat().st_ctime, reverse=True)
        gt_candidates.sort(key=lambda x: x.stat().st_ctime, reverse=True)
        self.layout_candidates.sort(key=lambda x: x.stat().st_ctime, reverse=True)

        self.origin_geojson = origin_candidates[0]
        self.gt_geojson = gt_candidates[0]
        self.layout_geojson = self.layout_candidates[0]
        # print(self.origin_geojson)
        # print(self.gt_geojson)
        # for geo in self.layout_candidates:
        #     print(geo)
        # print(self.layout_geojson)

    def lonlat_to_pixel(self, lon, lat):
        """将经纬度转换为 1500x900 图像的像素坐标"""
        w = self.bounds['east'] - self.bounds['west']
        h = self.bounds['north'] - self.bounds['south']
        
        x = (lon - self.bounds['west']) / w * self.img_width
        # 图像Y轴向下，纬度向上，需翻转
        y = (self.bounds['north'] - lat) / h * self.img_height
        return x, y

    def _generate_unique_id(self, feature, item_type, visual_id):
        """生成全局唯一标识符"""
        geom_type = feature['geometry']['type']
        name = feature['properties'].get('name', 'unknown')
        # eg: card-Point-解放碑步行街-card_spot_name
        return f"{item_type}-{geom_type}-{name}-{visual_id}"
    
    def parse_geojson(self, geojson_path):
        """解析单个 Geojson，提取 Point/LineString/Polygon/Card/Label"""
        from shapely.geometry import box, Polygon, LineString, Point

        with open(geojson_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        bbox_elements = {} # 存储 card 和 label 的 bbox
        geometries = [] # 存储 point, line, polygon 几何体(像素坐标下)
        
        for feature in data.get('features', []):
            geom_type = feature['geometry']['type']
            props = feature['properties']
            coords = feature['geometry']['coordinates']
            if geom_type == 'Point':
                px, py = self.lonlat_to_pixel(coords[0], coords[1])
                # 给点加上一个视觉半径 (例如 12px) 使其有面积可计算重叠
                geometries.append(Point(px, py).buffer(12))
            elif geom_type == 'LineString':
                px_coords = [self.lonlat_to_pixel(lon, lat) for lon, lat in coords]
                # 设定线宽 (例如 buffer(3) 代表 6px 宽)
                geometries.append(LineString(px_coords).buffer(3))
            elif geom_type == 'Polygon':
                px_coords = [[self.lonlat_to_pixel(lon, lat) for lon, lat in ring] for ring in coords]
                geometries.append(Polygon(px_coords[0], px_coords[1:]))
            
            # 处理 Card
            if 'card_visual_id' in props and 'card_coord' in props and 'card_size' in props:
                cid = self._generate_unique_id(feature, 'card', props['card_visual_id'])
                cx, cy = self.lonlat_to_pixel(*props['card_coord'])
                w, h = props['card_size']
                # coord 是中心点
                bbox_elements[cid] = box(cx - w/2, cy - h/2, cx + w/2, cy + h/2)
                
            # 处理 Label
            if 'label_visual_id' in props and 'label_coord' in props and 'label_size' in props:
                lid = self._generate_unique_id(feature, 'label', props['label_visual_id'])
                cx, cy = self.lonlat_to_pixel(*props['label_coord'])
                w, h = props['label_size']
                bbox_elements[lid] = box(cx - w/2, cy - h/2, cx + w/2, cy + h/2)
        return bbox_elements, geometries

    def extract_layout_runtimes(self):
        """从 layout GeoJSON 或旁路 manifest 中提取已记录的耗时，暂未记录则返回空列表。"""
        runtimes = []
        for path in self.layout_candidates:
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                candidates = [
                    data.get("_layout_runtime_ms"),
                    data.get("_runtime_ms"),
                    data.get("_layout", {}).get("runtime_ms") if isinstance(data.get("_layout"), dict) else None,
                ]
                for value in candidates:
                    if isinstance(value, (int, float)):
                        runtimes.append(value)
                        break
            except Exception:
                continue
        return runtimes

    def render_mask_img(self, geojson_path):
        """
        根据 GeoJSON 绘制: 黑白 mask
        返回 tuple: (mask图路径, 黑白mask numpy数组)
        """
        import cv2
        import numpy as np

        with open(geojson_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        mask_bw = np.zeros((self.img_height, self.img_width), dtype=np.uint8)
        
        # 绘制参数
        RED = (255, 0, 0)
        BLACK = 255  # 黑白 mask 中，红色元素对应 255
        POINT_RADIUS = 6
        LINE_WIDTH = 4
        
        for feature in data.get('features', []):
            geom_type = feature['geometry']['type']
            props = feature['properties']
            coords = feature['geometry']['coordinates']
            
            if geom_type == 'Point':
                px, py = self.lonlat_to_pixel(coords[0], coords[1])
                cv2.circle(mask_bw, (int(px), int(py)), POINT_RADIUS, BLACK, -1)
                            
            elif geom_type == 'LineString':
                px_coords = [self.lonlat_to_pixel(lon, lat) for lon, lat in coords]
                if len(px_coords) >= 2:
                    px_coords_int = [(int(x), int(y)) for x, y in px_coords]
                    cv2.polylines(mask_bw, [np.array(px_coords_int)], False, BLACK, LINE_WIDTH)
                    
            elif geom_type == 'Polygon':
                px_coords = [self.lonlat_to_pixel(lon, lat) for lon, lat in coords[0]] # 取外环
                if len(px_coords) >= 3:
                    px_coords_int = np.array([(int(x), int(y)) for x, y in px_coords])
                    cv2.polylines(mask_bw, [px_coords_int], True, BLACK, LINE_WIDTH)

            # 处理 Card
            if 'card_visual_id' in props and 'card_coord' in props and 'card_size' in props:
                cx, cy = self.lonlat_to_pixel(*props['card_coord'])
                w, h = props['card_size']
                x1, y1 = int(cx - w/2), int(cy - h/2)
                x2, y2 = int(cx + w/2), int(cy + h/2)
                
                cv2.rectangle(mask_bw, (x1, y1), (x2, y2), BLACK, -1)
                
            # 处理 Label
            if 'label_visual_id' in props and 'label_coord' in props and 'label_size' in props:
                cx, cy = self.lonlat_to_pixel(*props['label_coord'])
                w, h = props['label_size']
                x1, y1 = int(cx - w/2), int(cy - h/2)
                x2, y2 = int(cx + w/2), int(cy + h/2)
                
                cv2.rectangle(mask_bw, (x1, y1), (x2, y2), BLACK, -1)

        source_name = os.path.splitext(os.path.basename(geojson_path))[0]
        mask_output_path = os.path.join(self.output_dir, f"{source_name}_mask.jpg")
        cv2.imwrite(mask_output_path, mask_bw)
        print(f"✅ mask 已渲染并保存至: {mask_output_path}")
        return mask_bw
        
    def calc_session_metrics(self, include_aesthetics=True) -> dict:
        results = {
            "session": self.session_name,
            "gt": {},
            "origin": {},
            "layout": {}
        }
        # 读取并解析 geojson
        origin_bbox, origin_geo = self.parse_geojson(str(self.origin_geojson))
        gt_bbox, gt_geo = self.parse_geojson(str(self.gt_geojson))
        layout_bbox, layout_geo = self.parse_geojson(str(self.layout_geojson))
        # 计算并绘制 mask
        origin_mask = self.render_mask_img(self.origin_geojson)
        gt_mask = self.render_mask_img(self.gt_geojson)
        layout_mask = self.render_mask_img(self.layout_geojson)
        # 1. 计算布局重叠度
        results["origin"]["Overlap"] = calc_overlap(origin_bbox, origin_geo)
        results["gt"]["Overlap"] = calc_overlap(gt_bbox, gt_geo)
        results["layout"]["Overlap"] = calc_overlap(layout_bbox, layout_geo)
        # 2. 计算空间利用率
        results["origin"]["Utility"] = calc_utility(origin_bbox, origin_mask)
        results["gt"]["Utility"] = calc_utility(gt_bbox, gt_mask)
        results["layout"]["Utility"] = calc_utility(layout_bbox, layout_mask)
        # 3. 计算空间平衡性
        results["origin"]["Balance"] = calc_balance(origin_bbox, origin_mask)
        results["gt"]["Balance"] = calc_balance(gt_bbox, gt_mask)
        results["layout"]["Balance"] = calc_balance(layout_bbox, layout_mask)
        # 4. 计算与 GT 相似性
        results["origin"]["MeanIoU"] = calc_mean_iou(origin_bbox, gt_bbox)
        results["layout"]["MeanIoU"] = calc_mean_iou(layout_bbox, gt_bbox)
        # 5. 计算美观性 
        layout_img_path = self.session_path / "image" / "layout.jpg"
        origin_img_path = self.session_path / "image" / "origin.jpg"
        gt_img_path = self.session_path / "image" / "gt.jpg"
        if include_aesthetics:
            results["origin"]["Aesthetics"] = calc_aesthetics(origin_img_path, gt_img_path)
            results["layout"]["Aesthetics"] = calc_aesthetics(layout_img_path, gt_img_path)
        else:
            results["origin"]["Aesthetics"] = {
                "value": None,
                "description": METRIC_CONFIGS["Aesthetics"]["description"]
            }
            results["layout"]["Aesthetics"] = {
                "value": None,
                "description": METRIC_CONFIGS["Aesthetics"]["description"]
            }
        # 6. 计算算法稳定性
        bbox_elements_list = []
        for path in self.layout_candidates:
            bbox_elements, _ = self.parse_geojson(str(path))
            bbox_elements_list.append(bbox_elements)
        results["layout"]["Stability"] = calc_stability(bbox_elements_list)
        # 7. 计算算法平均耗时（只有 session 中已有 runtime 记录时才有值）
        results["layout"]["MeanTime"] = calc_mean_time(self.extract_layout_runtimes())
        # print(results)
        return results

def _metric_value(result, variant, metric):
    return result.get(variant, {}).get(metric, {}).get("value")


def _summarize_results(results):
    """按 variant/metric 汇总 count、mean、std，并计算 layout 相对 origin 的平均变化。"""
    summary = {
        "by_variant": {},
        "layout_vs_origin": {}
    }

    for variant in ["gt", "origin", "layout"]:
        summary["by_variant"][variant] = {}
        metrics = sorted({
            metric
            for result in results
            for metric in result.get(variant, {}).keys()
        })
        for metric in metrics:
            values = [
                _metric_value(result, variant, metric)
                for result in results
            ]
            values = [v for v in values if isinstance(v, (int, float))]
            if not values:
                summary["by_variant"][variant][metric] = {
                    "count": 0,
                    "mean": None,
                    "std": None,
                    "direction": METRIC_CONFIGS.get(metric, {}).get("direction")
                }
                continue
            summary["by_variant"][variant][metric] = {
                "count": len(values),
                "mean": float(round(float(_mean(values)), 4)),
                "std": float(round(float(_std(values)), 4)),
                "direction": METRIC_CONFIGS.get(metric, {}).get("direction")
            }

    comparable_metrics = sorted(set(summary["by_variant"]["origin"]).intersection(summary["by_variant"]["layout"]))
    for metric in comparable_metrics:
        paired_deltas = []
        paired_relative = []
        for result in results:
            origin_value = _metric_value(result, "origin", metric)
            layout_value = _metric_value(result, "layout", metric)
            if not isinstance(origin_value, (int, float)) or not isinstance(layout_value, (int, float)):
                continue
            delta = layout_value - origin_value
            paired_deltas.append(delta)
            if origin_value != 0:
                paired_relative.append(delta / abs(origin_value))

        if not paired_deltas:
            continue
        summary["layout_vs_origin"][metric] = {
            "count": len(paired_deltas),
            "mean_delta": float(round(float(_mean(paired_deltas)), 4)),
            "mean_relative_delta": float(round(float(_mean(paired_relative)), 4)) if paired_relative else None,
            "direction": METRIC_CONFIGS.get(metric, {}).get("direction")
        }

    return summary


def _flatten_result_rows(results):
    rows = []
    for result in results:
        session_name = result.get("session")
        for variant in ["gt", "origin", "layout"]:
            for metric, payload in result.get(variant, {}).items():
                rows.append({
                    "session": session_name,
                    "variant": variant,
                    "metric": metric,
                    "value": payload.get("value"),
                    "direction": METRIC_CONFIGS.get(metric, {}).get("direction", ""),
                    "description": payload.get("description", "")
                })
    return rows


def save_csv(results, csv_path):
    csv_path = Path(csv_path)
    csv_path.parent.mkdir(exist_ok=True, parents=True)
    rows = _flatten_result_rows(results)
    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["session", "variant", "metric", "value", "direction", "description"]
        )
        writer.writeheader()
        writer.writerows(rows)
    print(f"✅ CSV 结果已保存到: {csv_path}")
    return csv_path


def save_results(results: list, json_path=None, csv_path=None):
    """保存评估结果到 result 文件夹"""
    RESULT_DIR.mkdir(exist_ok=True)

    timestamp = time.strftime("%Y%m%d_%H%M%S")
    if isinstance(results, dict):
        results = [results]
    summary = {
        "evaluation_time": timestamp,
        "total_sessions": len(results),
        "sessions": results,
        "summary": _summarize_results(results)
    }
    result_path = Path(json_path) if json_path else RESULT_DIR / f"evaluation_result_{timestamp}.json"
    result_path.parent.mkdir(exist_ok=True, parents=True)
    with open(result_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=4)
    print(f"\n✅ 结果已保存到: {result_path}")

    if csv_path:
        save_csv(results, csv_path)

    return result_path


def discover_sessions():
    """发现 evaluate/ 下具备基础评估文件结构的 session。"""
    sessions = []
    for path in sorted(EVALUATE_DIR.iterdir()):
        if not path.is_dir() or path.name == "result" or path.name == "__pycache__":
            continue
        node3_dir = path / "node3"
        map_info = path / "mapInfo.json"
        if not map_info.exists() or not node3_dir.exists():
            continue
        has_origin = any(node3_dir.glob("*origin*.json"))
        has_layout = any(node3_dir.glob("*layout*.json"))
        has_gt = any(node3_dir.glob("*groundtruth*.json"))
        if has_origin and has_layout and has_gt:
            sessions.append(path.name)
    return sessions


def parse_args():
    parser = argparse.ArgumentParser(description="批量评估 MapLayout session。")
    parser.add_argument(
        "--sessions",
        nargs="+",
        default=[DEFAULT_SESSION],
        help="要评估的 session 名称；传入 all 自动评估所有可用 session。默认保持旧行为，只评估默认 session。"
    )
    parser.add_argument(
        "--skip-aesthetics",
        action="store_true",
        help="跳过 VLM aesthetics 评估，适合离线测试和批量 smoke test。"
    )
    parser.add_argument(
        "--json-out",
        default=None,
        help="指定 JSON 输出路径；默认写入 evaluate/result/evaluation_result_<timestamp>.json。"
    )
    parser.add_argument(
        "--csv-out",
        default=None,
        help="指定 CSV 输出路径；未指定则只输出 JSON。"
    )
    parser.add_argument(
        "--list-sessions",
        action="store_true",
        help="列出所有可批量评估的 session 后退出。"
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="遇到缺失文件或解析错误时立即失败；默认跳过坏 session。"
    )
    return parser.parse_args()


def main():
    args = parse_args()

    if args.list_sessions:
        for session_name in discover_sessions():
            print(session_name)
        return

    session_names = discover_sessions() if args.sessions == ["all"] else args.sessions
    if not session_names:
        raise RuntimeError("没有找到可评估的 session")

    all_results = []
    failures = []
    for session_name in session_names:
        try:
            print(f"\n▶️ 评估 session: {session_name}")
            session = Session(session_name)
            results = session.calc_session_metrics(include_aesthetics=not args.skip_aesthetics)
            all_results.append(results)
        except Exception as e:
            message = f"{session_name}: {e}"
            failures.append(message)
            print(f"⚠️ 跳过 session: {message}")
            if args.strict:
                raise

    if not all_results:
        raise RuntimeError(f"没有成功评估任何 session。失败信息: {failures}")

    result_path = save_results(all_results, json_path=args.json_out, csv_path=args.csv_out)
    if failures:
        print("\n⚠️ 以下 session 未完成评估：")
        for failure in failures:
            print(f"  - {failure}")
    print(f"\n📊 共完成 {len(all_results)} 个 session 的评估。JSON: {result_path}")


if __name__ == "__main__":
    main()
