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
from layoutEvaluator import LayoutEvaluator



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
    evaluator = LayoutEvaluator("mapInfo.json")
    
    # 1. 获取 Layout 中的几何 Bbox 字典
    layout_elements, _ = evaluator.parse_geojson("map_data_geojson_layout_01.json")
    
    # 2. 渲染只包含点线面、Card、Label红框的纯净合成图
    synthetic_img_path = evaluator.render_synthetic_image(
        geojson_path="map_data_geojson_layout_01.json",
        output_jpg_path="synthetic_map.jpg"
    )
    
    # 3. 送入 BASNet 提取显著性 Mask
    saliency_mask = evaluator.get_basnet_saliency(synthetic_img_path, "basnet.pth")
    
    # 4. 计算 Utility (空间利用率) 与 Balance (空间平衡性)
    # saliency_mask 的形状应为 (900, 1500)
    utility, balance = evaluator.calc_utility_and_balance(layout_elements, saliency_mask)
    
    print(f"3. 空间利用率 (Utility): {utility:.4f} (越大越好)")
    print(f"4. 空间平衡性 (Balance): {balance:.4f} (越大越好)")
    
    # 4. 模拟运行性能
    aet = run_algorithm_performance_tests()
    print(f"算法平均耗时 (AET): {aet:.4f} 秒")