# 核函数参数调整说明

## 问题
Card/Label 会处于 LineString 和 Polygon 之上，即 LineString 和 Polygon 被遮挡。

## 原因分析
核函数（Gaussian kernel）的影响范围由两个参数控制：
1. **`sigma`**: Gaussian 核的标准差，决定影响范围的衰减速率
2. **`obstaclePadding`**: 障碍物的物理扩展范围（LineString/Polygon 的半宽）

之前配置：
- `sigma: 28` - 影响范围较小
- `obstaclePadding: 6` - 障碍物半宽仅 6px

## 解决方案
**增大核函数的影响范围**，让 LineString 和 Polygon 产生更强的排斥力：

### 新配置
```typescript
const DEFAULT_FIELD: FieldParamsOverride = {
  sigma: 45,          // 从 28 增加到 45（扩大影响范围）
  strength: 1400,     // 保持不变
  obstaclePadding: 18, // 从 6 增加到 18（扩大障碍物物理范围）
  cellSize: 24,       // 保持不变
};
```

### 参数说明
- **`sigma: 45`**: Gaussian 核的影响范围扩大约 60%，使得 45px 距离内仍有显著排斥力
- **`obstaclePadding: 18`**: LineString 和 Polygon 的障碍物半宽从 6px 增加到 18px，确保 card/label 不会紧贴线条

### 影响范围估算
Gaussian 核公式：`exp(-d² / (2 * sigma²))`

| 距离 (px) | sigma=28 时的排斥力 | sigma=45 时的排斥力 |
|-----------|---------------------|---------------------|
| 0         | 1.0                 | 1.0                 |
| 20        | 0.72                | 0.88                |
| 40        | 0.34                | 0.62                |
| 60        | 0.11                | 0.33                |
| 80        | 0.02                | 0.14                |

## 修改的文件
1. `web/src/components/mapagent/TravelMap.tsx` - 默认参数
2. `web/src/app/agent/page.tsx` - Agent 页面默认参数

## 验证方法
1. 启动前端：`cd web && npm run dev`
2. 访问 Agent 页面，加载包含 LineString 和 Polygon 的地图数据
3. 观察 Card/Label 是否会被线条遮挡
4. 可通过 Debug 面板调整参数实时查看效果

## 进一步调优
如果仍有遮挡问题，可以继续增加：
- **`sigma`**: 增大到 50-60（最大 150）
- **`obstaclePadding`**: 增大到 20-25（最大 50）
- **`strength`**: 增大到 2000-3000（当前 1400）

如果排斥力过强（card/label 离线条太远），可以减小这些参数。

## 注意事项
- 参数调整**不改变方法框架**，仅调整核函数的影响范围
- 现有的 `buildCostFieldFromRects` 和 `fieldRepulsionForce` 逻辑完全保持不变
- ForceParamsPanel 中的滑块范围已支持新参数（sigma: 5-150, obstaclePadding: 0-50）
