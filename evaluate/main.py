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


EVALUATE_DIR = Path(__file__).parent
RESULT_DIR = EVALUATE_DIR / "result"


def find_session_folders():
    """自动扫描当前目录下的所有 session 文件夹"""
    sessions = []
    for item in EVALUATE_DIR.iterdir():
        if item.is_dir() and "session" in item.name:
            sessions.append(item.name)
    return sorted(sessions)


def get_latest_geojson(session_dir: Path, filename: str):
    """获取指定前缀的最新 geojson 文件"""
    node3_dir = session_dir / "node3"
    if not node3_dir.exists():
        return None
    
    candidates = list(node3_dir.glob(f"*{filename}*.json"))
    if not candidates:
        return None
    
    candidates.sort(key=lambda x: x.stat().st_mtime, reverse=True)
    return candidates[0].name


def get_all_geojson(session_dir: Path, filename: str):
    """获取指定前缀的所有 geojson 文件（最多 limit 个）"""
    node3_dir = session_dir / "node3"
    if not node3_dir.exists():
        return []
    
    candidates = list(node3_dir.glob(f"*{filename}*.json"))
    if not candidates:
        return []
    
    candidates.sort(key=lambda x: x.stat().st_mtime, reverse=True)
    return candidates


def calculate_stability(evaluator: LayoutEvaluator, geojson_paths: list) -> float:
    """计算算法稳定性（多次运行结果之间的平均两两 IoU）"""
    if len(geojson_paths) < 2:
        return None
    
    elements_list = []
    for path in geojson_paths:
        elements, _ = evaluator.parse_geojson(str(path))
        elements_list.append(elements)
    
    ious = []
    for i in range(len(elements_list)):
        for j in range(i + 1, len(elements_list)):
            mean_iou = evaluator.calc_mean_iou(elements_list[i], elements_list[j])
            ious.append(mean_iou)
    
    return np.mean(ious) if ious else None


def evaluate_geojson(evaluator: LayoutEvaluator, geojson_path: Path, session_dir: Path, skip_basnet: bool = False) -> dict:
    """评估单个 geojson 文件"""
    results = {}
    
    elements, background_geometries = evaluator.parse_geojson(str(geojson_path))
    
    overlap = evaluator.calc_overlap(elements, background_geometries)
    results["Overlap"] = {
        "value": float(round(overlap, 4)),
        "description": "布局重叠度，越小越好"
    }
    
    if not skip_basnet:
        try:
            output_dir = session_dir / "output"
            output_dir.mkdir(exist_ok=True)
            synthetic_img_path = output_dir / f"synthetic_{geojson_path.stem}.jpg"
            synthetic_img_path = evaluator.render_synthetic_image(
                geojson_path=str(geojson_path),
                output_jpg_path=str(synthetic_img_path)
            )
            saliency_mask = evaluator.get_basnet_saliency(synthetic_img_path, "./model/basnet.pth", output_dir=str(output_dir))
            utility, balance = evaluator.calc_utility_and_balance(elements, saliency_mask)
            results["Utility"] = {
                "value": float(round(utility, 4)),
                "description": "空间利用率，越大越好"
            }
            results["Balance"] = {
                "value": float(round(balance, 4)),
                "description": "空间平衡性，越大越好"
            }
        except Exception as e:
            results["Utility"] = {"error": str(e)}
            results["Balance"] = {"error": str(e)}
    
    return results


def evaluate_single_session(session_name: str, skip_basnet: bool = False) -> dict:
    """评估单个 session，同时评估 origin 和 layout"""
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
    
    evaluator = LayoutEvaluator(str(map_info_path))
    
    results = {
        "session": session_name,
        "origin": {},
        "layout": {}
    }
    
    layout_geojson = get_latest_geojson(session_dir, "layout")
    gt_geojson = get_latest_geojson(session_dir, "roundtruth")
    origin_geojson = get_latest_geojson(session_dir, "origin")
    
    if gt_geojson:
        gt_path = session_dir / "node3" / gt_geojson
        print(f"   GT: {gt_geojson}")
        gt_elements, _ = evaluator.parse_geojson(str(gt_path))
    
    if origin_geojson:
        origin_path = session_dir / "node3" / origin_geojson
        print(f"   Origin (Baseline): {origin_geojson}")
        origin_results = evaluate_geojson(evaluator, origin_path, session_dir, skip_basnet)
        
        if gt_geojson:
            origin_elements, _ = evaluator.parse_geojson(str(origin_path))
            mean_iou = evaluator.calc_mean_iou(origin_elements, gt_elements)
            origin_results["Mean IoU"] = {
                "value": float(round(mean_iou, 4)),
                "description": "与 GT 相似性，越大越好"
            }
        
        results["origin"] = origin_results
        print(f"all result: {results}")
        print(f"      Overlap: {origin_results.get('Overlap', {}).get('value', 'N/A')}")
        if "Mean IoU" in origin_results:
            print(f"      Mean IoU: {origin_results['Mean IoU']['value']}")
        if "Utility" in origin_results:
            print(f"      Utility: {origin_results['Utility']['value']}")
        if "Balance" in origin_results:
            print(f"      Balance: {origin_results['Balance']['value']}")
    else:
        print(f"   ⚠️ 未找到 origin geojson")
    
    if layout_geojson:
        layout_path = session_dir / "node3" / layout_geojson
        print(f"   Layout: {layout_geojson}")
        layout_results = evaluate_geojson(evaluator, layout_path, session_dir, skip_basnet)
        
        if gt_geojson:
            layout_elements, _ = evaluator.parse_geojson(str(layout_path))
            mean_iou = evaluator.calc_mean_iou(layout_elements, gt_elements)
            layout_results["Mean IoU"] = {
                "value": float(round(mean_iou, 4)),
                "description": "与 GT 相似性，越大越好"
            }
        
        layout_all_geojsons = get_all_geojson(session_dir, "layout")
        if len(layout_all_geojsons) >= 2:
            stability = calculate_stability(evaluator, layout_all_geojsons)
            if stability is not None:
                layout_results["Stability"] = {
                    "value": float(round(stability, 4)),
                    "description": "算法稳定性，多次运行结果的平均两两 IoU，越大越好"
                }
                print(f"      Stability: {stability:.4f}")
        
        results["layout"] = layout_results
        print(f"all result: {results}")
        print(f"      Overlap: {layout_results.get('Overlap', {}).get('value', 'N/A')}")
        if "Mean IoU" in layout_results:
            print(f"      Mean IoU: {layout_results['Mean IoU']['value']}")
        if "Utility" in layout_results:
            print(f"      Utility: {layout_results['Utility']['value']}")
        if "Balance" in layout_results:
            print(f"      Balance: {layout_results['Balance']['value']}")
    else:
        print(f"   ⚠️ 未找到 layout geojson")
    
    layout_img_path = session_dir / "image" / "layout.jpg"
    origin_img_path = session_dir / "image" / "origin.jpg"
    gt_img_path = session_dir / "image" / "gt.jpg"
    
    if layout_img_path.exists() and gt_img_path.exists():
        try:
            judge_win_rate = evaluator.calc_judge_win_rate(
                str(layout_img_path),
                str(gt_img_path)
            )
            results["layout"]["Judge Win Rate"] = {
                "value": float(round(judge_win_rate, 4)),
                "description": "裁判胜率，1.0=layout胜, 0.5=平局, 0.0=GT胜"
            }
            print(f"      Judge Win Rate: {judge_win_rate:.4f}")
        except Exception as e:
            print(f"      ⚠️ 裁判胜率计算失败: {e}")
            results["layout"]["Judge Win Rate"] = {"error": str(e)}
    
    if origin_img_path.exists() and gt_img_path.exists():
        try:
            judge_win_rate_origin = evaluator.calc_judge_win_rate(
                str(origin_img_path),
                str(gt_img_path)
            )
            results["origin"]["Judge Win Rate"] = {
                "value": float(round(judge_win_rate_origin, 4)),
                "description": "裁判胜率，1.0=origin胜, 0.5=平局, 0.0=GT胜"
            }
            print(f"      Judge Win Rate: {judge_win_rate_origin:.4f}")
        except Exception as e:
            results["origin"]["Judge Win Rate"] = {"error": str(e)}
    
    return results


def convert_numpy_types(obj):
    """将 numpy 类型转换为 Python 原生类型"""
    if isinstance(obj, dict):
        return {k: convert_numpy_types(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_numpy_types(item) for item in obj]
    elif hasattr(obj, 'item'):  # numpy scalar types
        return obj.item()
    else:
        return obj


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
        default=None,
        help="指定 session 文件夹名称进行评估"
    )
    parser.add_argument(
        "--all", 
        action="store_true",
        help="评估当前目录下所有 session"
    )
    parser.add_argument(
        "--skip-basnet",
        action="store_true",
        help="跳过 BASNet 相关计算（需要 GPU）"
    )
    
    args = parser.parse_args()
    
    results = []
    
    if args.session:
        result = evaluate_single_session(args.session, args.skip_basnet)
        if result:
            results.append(result)
    elif args.all:
        sessions = find_session_folders()
        print(f"📁 找到 {len(sessions)} 个 session: {sessions}")
        
        for session_name in sessions:
            result = evaluate_single_session(session_name, args.skip_basnet)
            if result:
                results.append(result)
    else:
        print("请指定 --session <名称> 或 --all")
        print("示例:")
        print("  python main.py --session 20260327_220636_session_1774620396")
        print("  python main.py --all")
        print("  python main.py --all --skip-basnet")
        return
    
    if results:
        save_results(results)


if __name__ == "__main__":
    main()
