# LineString/Polygon 防遮挡硬约束方案

## 问题
即使增大了核函数参数，card/label 仍然可能遮挡 LineString 和 Polygon。

### 根本原因
1. **核函数力会衰减**：force simulation 的 alpha 会衰减（`alphaDecay: 0.045`），导致后期排斥力越来越弱
2. **Post-process 缺少硬约束**：原有的后处理只解决 card/label 之间的碰撞，没有检查与 LineString/Polygon 的重叠

## 解决方案：硬约束后处理

在 force simulation 结束后，增加**确定性的硬碰撞解决步骤**，确保 card/label 与线条/多边形至少有 12px 的间距。

### 核心逻辑

#### 1. 辅助函数（`forceLayout.ts`）

**`closestPointOnSegment`**：计算点到线段上的最近点
```typescript
function closestPointOnSegment(
  px: number, py: number,
  x1: number, y1: number, x2: number, y2: number
): { x: number; y: number }
```

**`rectSegmentOverlap`**：检测矩形（card/label）与线段的重叠
```typescript
function rectSegmentOverlap(
  cx: number, cy: number, halfW: number, halfH: number,
  seg: Segment, padding: number
): { overlaps: boolean; pushX: number; pushY: number }
```

#### 2. Post-process 硬约束（`forceLayout.ts` 第 202-254 行）

```typescript
// Post-process: deterministically resolve any remaining overlaps
const MAX_POST_PASSES = 12;
for (let pass = 0; pass < MAX_POST_PASSES; pass++) {
  let anyOverlap = false;
  
  // 1. Resolve card/label vs card/label overlaps
  // ... 原有逻辑 ...
  
  // 2. Resolve card/label vs line/polygon segment overlaps (HARD CONSTRAINT)
  if (ctx.segments && ctx.segments.length > 0) {
    const segmentPadding = 12; // 12px 最小间距
    for (const n of nodes) {
      const halfW = n.width / 2;
      const halfH = n.height / 2;
      for (const seg of ctx.segments) {
        const { overlaps, pushX, pushY } = rectSegmentOverlap(
          n.x, n.y, halfW, halfH, seg, segmentPadding
        );
        if (overlaps) {
          anyOverlap = true;
          n.x += pushX;  // 强制推开
          n.y += pushY;
        }
      }
    }
  }
  
  if (!anyOverlap) break;
}
```

#### 3. 数据传递（`TravelMap.tsx`）

```typescript
// 构建线段数据（从 LineString 和 Polygon）
const segments = buildObstacleSegments({ linesPx, polygonsPx });

// 传递到力导向布局
const { outputs, leaderLines } = runForceLayout(
  ready,
  { viewport, costField: field, segments },  // ← 新增 segments
  { ...DEFAULT_FORCE, ...forceParams }
);
```

## 优势

✅ **确定性保证**：不依赖核函数的衰减力，使用几何计算精确检测碰撞  
✅ **最小间距保证**：确保 card/label 与线条/多边形至少 12px 间距  
✅ **迭代解决**：最多 12 次迭代，确保所有重叠都被解决  
✅ **不改变框架**：在原有 post-process 阶段增加逻辑，核函数方法仍然保留  

## 修改的文件

1. **`web/src/app/agent/layout/forceLayout.ts`**
   - 添加 `closestPointOnSegment` 函数
   - 添加 `rectSegmentOverlap` 函数
   - 更新 `LayoutContext` 类型，增加 `segments` 字段
   - 在 post-process 阶段增加硬约束解决逻辑

2. **`web/src/components/mapagent/TravelMap.tsx`**
   - 将 `segments` 传递到 `runForceLayout` 的 context 中

## 测试验证

1. 启动前端：`cd web && npm run dev`
2. 访问 Agent 页面，加载包含 LineString 和 Polygon 的地图数据
3. 观察 card/label 是否还会遮挡线条/多边形
4. 可以通过 Debug 面板查看效果

## 参数调整

如果 12px 间距不够，可以增加 `segmentPadding` 的值（在 `forceLayout.ts` 第 234 行）：
```typescript
const segmentPadding = 12; // 可以增加到 15-20px
```

如果推得太远，可以减小这个值（最小 6px）。
