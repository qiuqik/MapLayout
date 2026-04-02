# 评估布局算法
# session1: 20260327_220636_session_1774620396
# session2: 20260327_215848_session_1774619928
# session3: 20260327_133149_session_1774589509


import json
import time
import numpy as np
import cv2
from shapely.geometry import box, shape, Polygon, LineString, Point
import itertools

class LayoutEvaluator:
    def __init__(self, map_info_path, img_width=1500, img_height=900):
        self.img_width = img_width
        self.img_height = img_height
        
        # 1. 解析地图边界，用于经纬度到像素的转换
        with open(map_info_path, 'r', encoding='utf-8') as f:
            map_info = json.load(f)
            self.bounds = map_info['bounds']
            
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
        return f"{item_type}-{geom_type}-{name}-{visual_id}"

    def parse_geojson(self, geojson_path):
        """解析 GeoJSON，提取 Layout 元素 BBox 和 地理底图几何体"""
        with open(geojson_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        layout_elements = {} # 存储 card 和 label 的 bbox
        background_geometries = [] # 存储 point, line, polygon 几何体(像素坐标下)
        
        for feature in data.get('features', []):
            geom_type = feature['geometry']['type']
            props = feature['properties']
            coords = feature['geometry']['coordinates']
            
            # --- 处理背景要素 (转换为像素坐标并使用 shapely 表示) ---
            if geom_type == 'Point':
                px, py = self.lonlat_to_pixel(coords[0], coords[1])
                # 给点加上一个视觉半径 (例如 12px) 使其有面积可计算重叠
                background_geometries.append(Point(px, py).buffer(12)) 
            elif geom_type == 'LineString':
                px_coords = [self.lonlat_to_pixel(lon, lat) for lon, lat in coords]
                # 设定线宽 (例如 buffer(3) 代表 6px 宽)
                background_geometries.append(LineString(px_coords).buffer(3))
            elif geom_type == 'Polygon':
                px_coords = [[self.lonlat_to_pixel(lon, lat) for lon, lat in ring] for ring in coords]
                background_geometries.append(Polygon(px_coords[0], px_coords[1:]))

            # --- 处理排版要素 (Card & Label) ---
            # 处理 Card
            if 'card_visual_id' in props and 'card_coord' in props and 'card_size' in props:
                cid = self._generate_unique_id(feature, 'card', props['card_visual_id'])
                cx, cy = self.lonlat_to_pixel(*props['card_coord'])
                w, h = props['card_size']
                # coord 是中心点
                layout_elements[cid] = box(cx - w/2, cy - h/2, cx + w/2, cy + h/2)
                
            # 处理 Label
            if 'label_visual_id' in props and 'label_coord' in props and 'label_size' in props:
                lid = self._generate_unique_id(feature, 'label', props['label_visual_id'])
                cx, cy = self.lonlat_to_pixel(*props['label_coord'])
                w, h = props['label_size']
                layout_elements[lid] = box(cx - w/2, cy - h/2, cx + w/2, cy + h/2)
                
        return layout_elements, background_geometries

    # ==========================================
    # 1. 视觉感知指标 - JSON Based
    # ==========================================
    def calc_overlap(self, layout_elements, background_geometries):
        """
        指标 1: 布局重叠度 (Ove ↓)
        计算标签与标签之间、标签与地理要素(点线面)之间的遮挡程度
        """
        bboxes = list(layout_elements.values())
        if not bboxes: return 0.0
        
        total_label_area = sum([b.area for b in bboxes])
        overlap_area = 0.0
        
        # 1. 标签内部相互重叠 (Pairwise)
        for b1, b2 in itertools.combinations(bboxes, 2):
            if b1.intersects(b2):
                overlap_area += b1.intersection(b2).area
                
        # 2. 标签与地理底图(Point, Line, Polygon)的重叠
        for b in bboxes:
            for bg_geom in background_geometries:
                if b.intersects(bg_geom):
                    overlap_area += b.intersection(bg_geom).area
                    
        # 重叠度 = 重叠面积 / 标签总面积 (值越小越好)
        return overlap_area / total_label_area if total_label_area > 0 else 0.0

    def calc_mean_iou(self, pred_elements, gt_elements):
        """
        指标 2: 与 GT 的相似性 (Mean IoU ↑)
        """
        ious = []
        for uid, pred_box in pred_elements.items():
            if uid in gt_elements:
                gt_box = gt_elements[uid]
                intersection = pred_box.intersection(gt_box).area
                union = pred_box.union(gt_box).area
                ious.append(intersection / union if union > 0 else 0.0)
            else:
                ious.append(0.0) # 错漏标算作 0
                
        return np.mean(ious) if ious else 0.0

    # ==========================================
    # 2. 视觉感知指标 - Image/Saliency Based
    # ==========================================
    def get_basnet_saliency(self, image_path):
        """
        Mock: 调用 BASNet 获取显著性图 (不加地图底图)
        实际应用时请替换为 BASNet 推理代码
        """
        # img = cv2.imread(image_path)
        # input_tensor = preprocess(img)
        # output = basnet_model(input_tensor)
        # return output_mask (单通道 0-255 numpy array)
        
        # 这里返回一个随机模拟的显著性图
        return np.random.randint(0, 255, (self.img_height, self.img_width), dtype=np.uint8)

    def calc_utility_and_balance(self, layout_elements, basnet_saliency_map):
        """
        指标 3 & 4: 空间利用率 (Uti ↑) & 空间平衡性 (Bal ↑)
        """
        # 归一化显著性图 [0, 1]
        saliency = basnet_saliency_map.astype(np.float32) / 255.0
        
        # 构建标签占用 Mask
        label_mask = np.zeros((self.img_height, self.img_width), dtype=np.float32)
        for bbox in layout_elements.values():
            minx, miny, maxx, maxy = map(int, bbox.bounds)
            # 限制边界
            minx, miny = max(0, minx), max(0, miny)
            maxx, maxy = min(self.img_width, maxx), min(self.img_height, maxy)
            label_mask[miny:maxy, minx:maxx] = 1.0

        # --- 指标 3: Utility ---
        # 标签遮挡的显著性信息量
        occluded_saliency = np.sum(saliency * label_mask)
        total_saliency = np.sum(saliency)
        # 遮挡越少，利用率越高
        utility = 1.0 - (occluded_saliency / total_saliency if total_saliency > 0 else 0)

        # --- 指标 4: Balance ---
        # 将画面分为 3x3 网格
        grid_rows, grid_cols = 3, 3
        h_step, w_step = self.img_height // grid_rows, self.img_width // grid_cols
        
        density_label = []
        density_saliency = []
        
        for r in range(grid_rows):
            for c in range(grid_cols):
                r_start, r_end = r * h_step, (r + 1) * h_step
                c_start, c_end = c * w_step, (c + 1) * w_step
                
                # 网格内标签占比
                grid_label = label_mask[r_start:r_end, c_start:c_end]
                density_label.append(np.sum(grid_label) / (h_step * w_step))
                
                # 网格内底图信息量占比
                grid_sal = saliency[r_start:r_end, c_start:c_end]
                density_saliency.append(np.sum(grid_sal) / (h_step * w_step))

        # 归一化分布
        p_label = np.array(density_label) / (np.sum(density_label) + 1e-6)
        p_saliency = np.array(density_saliency) / (np.sum(density_saliency) + 1e-6)
        
        # 计算分布的均方误差，MSE越小越平衡（标签分布贴合底图信息分布）
        mse = np.mean((p_label - p_saliency) ** 2)
        balance = 1.0 / (1.0 + mse)
        
        return utility, balance

    # ==========================================
    # 3. MLLM 裁判胜率 (需调用 API)
    # ==========================================
    def calc_judge_win_rate(self, layout_img_path, gt_img_path):
        """
        指标 5: Judge Win Rate (需对接 GPT-4o 或 Claude 3.5 API)
        这里写个框架逻辑
        """
        prompt = """你是一个地图排版专家。我上传了图A和图B。
        请从：1. 遮挡情况 2. 视觉呼吸感 3. 文字-图标对齐度，三个维度评价。
        严格以JSON输出，只包含字段 "winner" (值为 "A", "B", 或 "Tie")"""
        
        # prompt = call_mllm(prompt, imgA, imgB)
        # 这里用模拟值代替
        mock_winner = "A" # 假设 A 是我们的 layout
        if mock_winner == "A": return 1.0
        elif mock_winner == "Tie": return 0.5
        else: return 0.0

# ==========================================
# 4. 算法性能指标测算脚本 (时间与稳定性)
# ==========================================
def run_algorithm_performance_tests():
    """
    运行耗时 (AET ↓) 与 稳定性 (Sta ↑) 计算框架
    """
    execution_times = []
    layouts_results = []
    evaluator = LayoutEvaluator("mapInfo.json")
    
    # 运行 10 次测试算法
    for i in range(10):
        start_time = time.perf_counter()
        
        # ----------------------------------------------------
        # 这里执行你的布局算法
        # 退出条件: max(|dx|, |dy|) < 0.1 像素 (针对迭代算法)
        # my_layout_json = run_my_layout_algorithm("origin_01.json")
        # ----------------------------------------------------
        
        end_time = time.perf_counter()
        execution_times.append(end_time - start_time)
        
        # 模拟读取结果
        # layout_elements, _ = evaluator.parse_geojson(f"my_output_{i}.json")
        # layouts_results.append(layout_elements)

    # 1. 计算 AET (剔除异常值)
    execution_times.sort()
    # 去除最快1个和最慢1个
    valid_times = execution_times[1:-1]
    aet = np.mean(valid_times)
    
    # 2. 计算 Sta (平均两两 IoU)
    # ious = []
    # for res1, res2 in itertools.combinations(layouts_results, 2):
    #     ious.append(evaluator.calc_mean_iou(res1, res2))
    # stability = np.mean(ious)
    
    return aet # , stability


if __name__ == "__main__":
    # --- 主测试流程 ---
    evaluator = LayoutEvaluator("mapInfo.json")
    
    # 1. 解析 GeoJSON 获得要素和背景集合
    layout_elements, bg_geoms = evaluator.parse_geojson("map_data_geojson_layout_01.json")
    gt_elements, _ = evaluator.parse_geojson("map_data_geojson_groundtruth_01.json")
    
    # 2. 计算纯 JSON 指标
    overlap = evaluator.calc_overlap(layout_elements, bg_geoms)
    iou = evaluator.calc_mean_iou(layout_elements, gt_elements)
    print(f"1. 布局重叠度 (Overlap): {overlap:.4f} (越小越好)")
    print(f"2. GT 相似性 (Mean IoU): {iou:.4f} (越大越好)")
    
    # 3. 计算基于图像的显著性指标
    saliency_map = evaluator.get_basnet_saliency("render_baseline.png") # 输入无底图的纯要素渲染图
    utility, balance = evaluator.calc_utility_and_balance(layout_elements, saliency_map)
    print(f"3. 空间利用率 (Utility): {utility:.4f} (越大越好)")
    print(f"4. 空间平衡性 (Balance): {balance:.4f} (越大越好)")
    
    # 4. 模拟运行性能
    aet = run_algorithm_performance_tests()
    print(f"算法平均耗时 (AET): {aet:.4f} 秒")