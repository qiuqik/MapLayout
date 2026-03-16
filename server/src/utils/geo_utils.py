"""
地理相关的工具函数
"""

from typing import List, Tuple

def compute_convex_hull(points: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
    """
    计算最小凸包
    
    Args:
        points: 点的列表，每个点为 (lng, lat) 元组
    
    Returns:
        凸包点的列表，按顺序排列，包含缓冲范围
    """
    # 移除重复点
    points = list(set(tuple(point) for point in points))
    
    # 处理点数量不足的情况
    if len(points) <= 1:
        # 如果只有一个点，返回一个包含该点的简单多边形
        return [points[0], (points[0][0] + 0.001, points[0][1]), (points[0][0], points[0][1] + 0.001), points[0]]
    if len(points) == 2:
        # 如果只有两个点，返回一个包含这两个点的简单多边形
        p1, p2 = points
        # 创建一个包含这两个点的矩形
        return [p1, (p2[0], p1[1]), p2, (p1[0], p2[1]), p1]
    
    # 找到最左下的点
    points.sort(key=lambda p: (p[0], p[1]))
    start = points[0]
    
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    
    # 极角排序
    def polar_angle(p):
        dx = p[0] - start[0]
        dy = p[1] - start[1]
        if dx == 0 and dy == 0:
            return 0
        return (dy / (dx**2 + dy**2)**0.5) if dx != 0 else 1
    
    points[1:] = sorted(points[1:], key=polar_angle)
    
    # 构建凸包
    hull = [start, points[1]]
    for p in points[2:]:
        while len(hull) >= 2 and cross(hull[-2], hull[-1], p) <= 0:
            hull.pop()
        hull.append(p)
    
    # 确保凸包至少有三个点
    if len(hull) < 3:
        # 如果凸包点数不足，添加额外的点来形成一个多边形
        p1 = hull[0]
        p2 = hull[1]
        # 创建一个第三个点
        p3 = ((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2 + 0.001)
        hull.append(p3)
    
    # 添加缓冲范围（0.001度约等于111米）
    buffer = 0.001
    buffered_hull = []
    for i, (lng, lat) in enumerate(hull):
        # 计算当前点与下一个点的方向向量
        next_lng, next_lat = hull[(i + 1) % len(hull)]
        prev_lng, prev_lat = hull[(i - 1) % len(hull)]
        
        # 计算方向向量
        dx1 = next_lng - lng
        dy1 = next_lat - lat
        dx2 = prev_lng - lng
        dy2 = prev_lat - lat
        
        # 归一化向量
        len1 = (dx1**2 + dy1**2)**0.5
        len2 = (dx2**2 + dy2**2)**0.5
        
        if len1 > 0:
            dx1 /= len1
            dy1 /= len1
        if len2 > 0:
            dx2 /= len2
            dy2 /= len2
        
        # 计算法向量（平均两个相邻边的法向量）
        nx = (dy1 - dy2) / 2
        ny = (-dx1 + dx2) / 2
        len_n = (nx**2 + ny**2)**0.5
        if len_n > 0:
            nx /= len_n
            ny /= len_n
        
        # 添加缓冲
        buffered_lng = lng + nx * buffer
        buffered_lat = lat + ny * buffer
        buffered_hull.append((buffered_lng, buffered_lat))
    
    # 确保凸包闭合
    if buffered_hull[0] != buffered_hull[-1]:
        buffered_hull.append(buffered_hull[0])
    
    return buffered_hull
