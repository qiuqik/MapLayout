import numpy as np
from pathlib import Path


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
    "Mean IoU": {
        "description": "与 GT 相似性，越大越好",
        "direction": "higher",
    },
    "Stability": {
        "description": "算法稳定性，多次运行结果的平均两两 IoU，越大越好",
        "direction": "higher",
    },
    "Aesthetics": {
        "description": "美观性，1.0=胜, 0.5=平局, 0.0=负",
        "direction": "higher",
    },
}


def print_metrics(metrics: dict, prefix: str = ""):
    """打印指标结果"""
    for key, value in metrics.items():
        if isinstance(value, dict):
            val = value.get("value", value.get("error", "N/A"))
            if isinstance(val, (int, float)):
                print(f"      {prefix}{key}: {val:.4f}" if isinstance(val, float) else f"      {prefix}{key}: {val}")
            else:
                print(f"      {prefix}{key}: {val}")


def find_session_folders(evaluate_dir: Path):
    """自动扫描当前目录下的所有 session 文件夹"""
    sessions = []
    for item in evaluate_dir.iterdir():
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
    """获取指定前缀的所有 geojson 文件"""
    node3_dir = session_dir / "node3"
    if not node3_dir.exists():
        return []
    
    candidates = list(node3_dir.glob(f"*{filename}*.json"))
    if not candidates:
        return []
    
    candidates.sort(key=lambda x: x.stat().st_mtime, reverse=True)
    return candidates


def calculate_stability(evaluator, geojson_paths: list) -> float:
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


def convert_numpy_types(obj):
    """将 numpy 类型转换为 Python 原生类型"""
    if isinstance(obj, dict):
        return {k: convert_numpy_types(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_numpy_types(item) for item in obj]
    elif hasattr(obj, 'item'):
        return obj.item()
    else:
        return obj
