# 评估布局算法
# 支持单个 session 文件夹评估和批量评估
# 同时评估 origin (baseline) 和 layout (优化后)

import os
import sys
import json
import time
import argparse
import numpy as np
from pathlib import Path
from layoutEvaluator import LayoutEvaluator
from utils import (
    find_session_folders, 
    get_latest_geojson, 
    get_all_geojson, 
    calculate_stability, 
    convert_numpy_types,
    METRIC_CONFIGS,
    print_metrics,
)


EVALUATE_DIR = Path(__file__).parent
RESULT_DIR = EVALUATE_DIR / "result"


def calc_geojson_metrics(evaluator: LayoutEvaluator, geojson_path: Path, output_dir: Path) -> dict:
    """计算单个 geojson 文件的所有指标"""
    results = {}
    
    elements, background_geometries = evaluator.parse_geojson(str(geojson_path))
    
    overlap = evaluator.calc_overlap(elements, background_geometries)
    results["Overlap"] = {
        "value": float(round(overlap, 4)),
        "description": METRIC_CONFIGS["Overlap"]["description"]
    }
    
    try:
        synthetic_img_path = output_dir / f"synthetic_{geojson_path.stem}.jpg"
        # 一步绘制：获得合成图路径 和 黑白 mask
        _, saliency_mask = evaluator.render_synthetic_image(
            geojson_path=str(geojson_path),
            output_jpg_path=str(synthetic_img_path)
        )
        utility, balance = evaluator.calc_utility_and_balance(elements, saliency_mask)
        results["Utility"] = {
            "value": float(round(utility, 4)),
            "description": METRIC_CONFIGS["Utility"]["description"]
        }
        results["Balance"] = {
            "value": float(round(balance, 4)),
            "description": METRIC_CONFIGS["Balance"]["description"]
        }
    except Exception as e:
        results["Utility"] = {"error": str(e)}
        results["Balance"] = {"error": str(e)}
    
    return results


def calc_mean_iou_with_gt(evaluator: LayoutEvaluator, pred_path: Path, gt_elements: dict) -> dict:
    """计算与 GT 的 Mean IoU"""
    pred_elements, _ = evaluator.parse_geojson(str(pred_path))
    mean_iou = evaluator.calc_mean_iou(pred_elements, gt_elements)
    return {
        "value": float(round(mean_iou, 4)),
        "description": METRIC_CONFIGS["Mean IoU"]["description"]
    }


def calc_aesthetics(evaluator: LayoutEvaluator, img_path: Path, gt_img_path: Path, result_key: str) -> dict:
    """计算美观性（Judge Win Rate）"""
    if not img_path.exists() or not gt_img_path.exists():
        return None
    
    try:
        win_rate = evaluator.calc_judge_win_rate(str(img_path), str(gt_img_path))
        return {
            "value": float(round(win_rate, 4)),
            "description": f"美观性（{result_key} vs GT），{METRIC_CONFIGS['Aesthetics']['description']}"
        }
    except Exception as e:
        return {"error": str(e)}


def calc_stability(evaluator: LayoutEvaluator, session_dir: Path) -> dict:
    """计算算法稳定性"""
    layout_all_geojsons = get_all_geojson(session_dir, "layout")
    if len(layout_all_geojsons) >= 2:
        stability = calculate_stability(evaluator, layout_all_geojsons)
        if stability is not None:
            return {
                "value": float(round(stability, 4)),
                "description": METRIC_CONFIGS["Stability"]["description"]
            }
    return None


def evaluate_single_session(session_name: str) -> dict:
    """评估单个 session，同时评估 origin、layout 和 gt"""
    session_dir = EVALUATE_DIR / session_name
    if not session_dir.exists():
        print(f"❌ Session 不存在: {session_name}")
        return None
    
    print(f"\n{'='*60}")
    print(f"📂 正在评估: {session_name}")
    print(f"{'='*60}")
    
    map_info_path = session_dir / "mapInfo.json"
    if not map_info_path.exists():
        print(f"❌ mapInfo.json 不存在")
        return None
    
    output_dir = session_dir / "output"
    output_dir.mkdir(exist_ok=True)
    
    evaluator = LayoutEvaluator(str(map_info_path))
    
    results = {
        "session": session_name,
        "gt": {},
        "origin": {},
        "layout": {}
    }
    
    layout_geojson = get_latest_geojson(session_dir, "layout")
    gt_geojson = get_latest_geojson(session_dir, "roundtruth")
    origin_geojson = get_latest_geojson(session_dir, "origin")
    
    gt_elements = None
    if gt_geojson:
        gt_path = session_dir / "node3" / gt_geojson
        print(f"   GT: {gt_geojson}")
        gt_results = calc_geojson_metrics(evaluator, gt_path, output_dir)
        results["gt"] = gt_results
        print_metrics(gt_results, "GT - ")
        
        _, gt_elements = evaluator.parse_geojson(str(gt_path))
    
    if origin_geojson:
        origin_path = session_dir / "node3" / origin_geojson
        print(f"   Origin (Baseline): {origin_geojson}")
        origin_results = calc_geojson_metrics(evaluator, origin_path, output_dir)
        
        if gt_geojson and gt_elements:
            origin_results["Mean IoU"] = calc_mean_iou_with_gt(evaluator, origin_path, gt_elements)
        
        results["origin"] = origin_results
        print_metrics(origin_results, "Origin - ")
    else:
        print(f"   ⚠️ 未找到 origin geojson")
    
    if layout_geojson:
        layout_path = session_dir / "node3" / layout_geojson
        print(f"   Layout: {layout_geojson}")
        layout_results = calc_geojson_metrics(evaluator, layout_path, output_dir)
        
        if gt_geojson and gt_elements:
            layout_results["Mean IoU"] = calc_mean_iou_with_gt(evaluator, layout_path, gt_elements)
        
        stability_result = calc_stability(evaluator, session_dir)
        if stability_result:
            layout_results["Stability"] = stability_result
            print(f"      Layout - Stability: {stability_result['value']:.4f}")
        
        results["layout"] = layout_results
        print_metrics(layout_results, "Layout - ")
    else:
        print(f"   ⚠️ 未找到 layout geojson")
    
    layout_img_path = session_dir / "image" / "layout.jpg"
    origin_img_path = session_dir / "image" / "origin.jpg"
    gt_img_path = session_dir / "image" / "gt.jpg"
    
    if gt_img_path.exists():
        if layout_geojson and layout_img_path.exists():
            aesthetics = calc_aesthetics(evaluator, layout_img_path, gt_img_path, "Layout")
            if aesthetics:
                results["layout"]["Aesthetics"] = aesthetics
                print(f"      Layout - Aesthetics: {aesthetics['value']:.4f}")
        
        if origin_geojson and origin_img_path.exists():
            aesthetics = calc_aesthetics(evaluator, origin_img_path, gt_img_path, "Origin")
            if aesthetics:
                results["origin"]["Aesthetics"] = aesthetics
                print(f"      Origin - Aesthetics: {aesthetics['value']:.4f}")
    
    return results


def save_results(results: list):
    """保存评估结果到 result 文件夹"""
    RESULT_DIR.mkdir(exist_ok=True)
    
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    
    summary = {
        "evaluation_time": timestamp,
        "total_sessions": len(results),
        "sessions": []
    }
    
    for result in results:
        if result:
            summary["sessions"].append(convert_numpy_types(result))
    
    summary_path = RESULT_DIR / f"evaluation_summary_{timestamp}.json"
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    
    print(f"\n✅ 结果已保存到: {summary_path}")
    return summary_path


def main():
    parser = argparse.ArgumentParser(description="布局评估工具")
    parser.add_argument(
        "--session", 
        type=str, 
        help="指定要评估的 session 文件夹名称"
    )
    parser.add_argument(
        "--all", 
        action="store_true", 
        help="评估所有 session 文件夹"
    )
    args = parser.parse_args()
    
    results = []
    
    if args.session:
        result = evaluate_single_session(args.session)
        if result:
            results.append(result)
    elif args.all:
        sessions = find_session_folders(EVALUATE_DIR)
        print(f"📁 找到 {len(sessions)} 个 session: {sessions}")
        
        for session_name in sessions:
            result = evaluate_single_session(session_name)
            if result:
                results.append(result)
    else:
        print("请指定 --session <名称> 或 --all")
        print("示例:")
        print("  python main.py --session 20260327_220636_session_1774620396")
        print("  python main.py --all")
        return
    
    if results:
        save_results(results)


if __name__ == "__main__":
    main()
