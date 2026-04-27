# 地图标签/卡片布局算法技术文档

本文档详细描述了三种标签/卡片布局算法的实现原理、核心机制和参数配置。三种算法分别为：
1. 力导向布局 (Force-Directed Layout)
2. 模拟退火布局 (Simulated Annealing Layout)
3. Voronoi+力导向混合布局 (Voronoi+Force Hybrid Layout)

---

## 1. 力导向布局 (Force-Directed Layout)

### 1.1 核心思想

力导向布局源自于图布局领域，其核心思想是将标签模拟为物理系统中相互作用的粒子，通过迭代求解系统势能的最小化来获得最终布局。

**主要作用力**：
- **锚点吸引力 (Link Force)**：将标签拉向其对应的地图锚点，保持标签与锚点的关联性
- **碰撞排斥力 (Collide Force)**：防止标签之间发生重叠
- **势场斥力 (Field Repulsion)**：利用预计算的代价场（cost field）避开路线等障碍物
- **边界约束力 (Bounding Force)**：将标签限制在视口范围内

### 1.2 实现细节

#### 节点数据结构

```typescript
type SimNode = {
  id: string;
  x: number;           // 当前X坐标（标签中心）
  y: number;           // 当前Y坐标（标签中心）
  vx: number;          // X方向速度
  vy: number;          // Y方向速度
  width: number;       // 标签宽度
  height: number;      // 标签高度
  padding: number;      // 内边距
  anchorX: number;     // 锚点X坐标
  anchorY: number;     // 锚点Y坐标
};
```

#### 自定义力函数

系统基于 `d3-force` 库构建，但额外实现了三个自定义力：

**边界约束力 (boundingForce)**

```typescript
function boundingForce(ctx: LayoutContext, params: LayoutParams) {
  let nodes: SimNode[] = [];
  function force(alpha: number) {
    const pad = params.boundsPadding;
    const w = ctx.viewport.width;
    const h = ctx.viewport.height;
    for (const n of nodes) {
      const halfW = n.width / 2;
      const halfH = n.height / 2;
      const minX = pad + halfW;
      const maxX = w - pad - halfW;
      const minY = pad + halfH;
      const maxY = h - pad - halfH;
      const tx = clamp(n.x, minX, maxX);
      const ty = clamp(n.y, minY, maxY);
      n.vx += (tx - n.x) * alpha * 2;
      n.vy += (ty - n.y) * alpha * 2;
    }
  }
  force.initialize = (ns: any[]) => { nodes = ns as SimNode[]; };
  return force as any;
}
```

**势场斥力 (fieldRepulsionForce)**

对节点中心及四角（共5个采样点）计算势场合力，引导标签远离高代价区域：

```typescript
function fieldRepulsionForce(ctx: LayoutContext, params: LayoutParams) {
  let nodes: SimNode[] = [];
  function force(alpha: number) {
    if (!ctx.costField) return;
    const k = alpha * params.fieldStrength;
    for (const n of nodes) {
      const hw = n.width / 2;
      const hh = n.height / 2;
      let sumFx = 0, sumFy = 0;
      const sampleX = [n.x, n.x - hw, n.x + hw, n.x - hw, n.x + hw];
      const sampleY = [n.y, n.y - hh, n.y - hh, n.y + hh, n.y + hh];
      for (let s = 0; s < 5; s++) {
        const { fx, fy } = sampleCostFieldForce(ctx.costField, sampleX[s], sampleY[s]);
        sumFx += fx;
        sumFy += fy;
      }
      n.vx += (sumFx / 5) * k;
      n.vy += (sumFy / 5) * k;
    }
  }
  force.initialize = (ns: any[]) => { nodes = ns as SimNode[]; };
  return force as any;
}
```

#### 后处理：硬约束冲突解决

力模拟退火后可能仍有残留重叠，通过后处理强制消除：

```typescript
for (let pass = 0; pass < MAX_POST_PASSES; pass++) {
  // 1. 标签间重叠解决
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const overlapX = a.width/2 + b.width/2 + a.padding + b.padding - Math.abs(dx);
      const overlapY = a.height/2 + b.height/2 + a.padding + b.padding - Math.abs(dy);
      if (overlapX > 0 && overlapY > 0) {
        // 沿最小重叠方向推开
      }
    }
  }

  // 2. 标签与线段重叠解决
  if (ctx.segments && ctx.segments.length > 0) {
    // 计算最近点，计算重叠向量，推开
  }

  // 3. 标签与全局矩形重叠解决
  if (ctx.globalRects && ctx.globalRects.length > 0) {
    // 计算AABB重叠，推开
  }

  if (!anyOverlap) break;
}
```

### 1.3 参数配置

```typescript
export type LayoutParams = {
  /** 锚点吸引力强度 (0.16) */
  linkStrength: number;
  /** 矩形碰撞强度 (3.5) */
  collideStrength: number;
  /** 势场斥力强度 (1.8) */
  fieldStrength: number;
  /** 视口边界留白 (10) */
  boundsPadding: number;
  /** 初始热力值 (0.3) */
  alpha: number;
  /** 热力衰减率 (0.02) */
  alphaDecay: number;
  /** 最小热力阈值 (0.001) */
  alphaMin: number;
  /** 最小迭代次数 (500) */
  iterations: number;
  /** 引导线长度阈值 */
  leaderThreshold: number;
};

export const DEFAULT_FORCE: LayoutParams = {
  linkStrength: 0.16,
  collideStrength: 3.5,
  fieldStrength: 1.8,
  boundsPadding: 10,
  alpha: 0.3,
  alphaDecay: 0.02,
  alphaMin: 0.001,
  iterations: 500,
  leaderThreshold: 60,
};
```

### 1.4 参数影响说明

| 参数 | 增大效果 | 减小效果 | 推荐范围 |
|------|----------|----------|----------|
| linkStrength | 标签更靠近锚点 | 标签分布更均匀但可能远离锚点 | 0.1 ~ 0.3 |
| collideStrength | 碰撞排斥更强 | 可能出现重叠 | 2.0 ~ 5.0 |
| fieldStrength | 更强避开障碍物 | 可能穿过代价场 | 1.0 ~ 3.0 |
| alpha | 更激进迭代 | 收敛更慢 | 0.1 ~ 0.5 |
| alphaDecay | 更快冷却 | 更慢冷却 | 0.01 ~ 0.05 |
| boundsPadding | 更大边距 | 标签更靠近边界 | 5 ~ 20 |

---

## 2. 模拟退火布局 (Simulated Annealing Layout)

### 2.1 核心思想

模拟退火算法源于金属退火的物理过程，通过引入"温度"参数控制随机搜索，逐步降低温度使系统趋于稳定。

**与力导向的本质区别**：力导向是连续优化（梯度下降），模拟退火是离散随机搜索，更容易跳出局部最优。

**核心公式**：
- 接受准则：`P = exp(-ΔE/T)`
- 温度衰减：`T_new = T_old × coolingRate`

### 2.2 实现细节

#### 能量函数设计

系统总能量由多个能量项组成：

```typescript
function calculateTotalEnergy(nodes: SimNode[], costField?, segments?, globalRects?): number {
  let energy = 0;

  // 1. 锚点关联能量（权重0.1）
  for (const node of nodes) {
    energy += calculateLinkEnergy(node) * 0.1;
  }

  // 2. 标签重叠能量（权重1）
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      energy += calculateOverlapEnergy(nodes[i], nodes[j]);
    }
  }

  // 3. 势场能量（权重2）
  if (costField) {
    for (const node of nodes) {
      energy += calculateFieldEnergy(node, costField) * 2;
    }
  }

  // 4. 线段重叠能量（权重50）
  if (segments && segments.length > 0) {
    for (const node of nodes) {
      energy += calculateSegmentOverlapEnergy(node, segments) * 50;
    }
  }

  // 5. 全局矩形重叠能量（权重1）
  if (globalRects && globalRects.length > 0) {
    for (const node of nodes) {
      energy += calculateGlobalRectOverlapEnergy(node, globalRects);
    }
  }

  return energy;
}
```

#### 重叠能量计算

```typescript
function calculateOverlapEnergy(a: SimNode, b: SimNode): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const overlapX = a.width/2 + b.width/2 + a.padding + b.padding - Math.abs(dx);
  const overlapY = a.height/2 + b.height/2 + a.padding + b.padding - Math.abs(dy);

  if (overlapX <= 0 || overlapY <= 0) return 0;
  return overlapX * overlapY * 10;
}
```

#### 线段重叠能量计算

```typescript
function calculateSegmentOverlapEnergy(node: SimNode, segments: Segment[]): number {
  let energy = 0;
  const halfW = node.width / 2;
  const halfH = node.height / 2;
  const padding = 12;  // 与线的安全距离

  for (const seg of segments) {
    // AABB粗检测
    if (nodeMaxX < segMinX || nodeMinX > segMaxX ||
        nodeMaxY < segMinY || nodeMinY > segMaxY) {
      continue;
    }

    // 计算到线段最近点的距离
    const closestX = Math.max(segMinX, Math.min(node.x, segMaxX));
    const closestY = Math.max(segMinY, Math.min(node.y, segMaxY));
    const dist = Math.sqrt((node.x - closestX)² + (node.y - closestY)²);

    if (dist < Math.min(halfW + padding, halfH + padding)) {
      energy += (Math.min(halfW + padding, halfH + padding) - dist) * 5;
    }
  }
  return energy;
}
```

#### 邻域搜索

```typescript
function randomNeighbor(
  node: SimNode,
  stepSize: number,
  viewport: { width: number; height: number },
  padding: number
): SimNode {
  const angle = Math.random() * 2 * Math.PI;
  const dist = Math.random() * stepSize;
  const dx = Math.cos(angle) * dist;
  const dy = Math.sin(angle) * dist;

  return {
    ...node,
    x: clamp(node.x + dx, padding + node.width/2, viewport.width - padding - node.width/2),
    y: clamp(node.y + dy, padding + node.height/2, viewport.height - padding - node.height/2),
  };
}
```

#### 主循环

```typescript
export function runSimulatedAnnealingLayout(inputs, ctx, params) {
  let nodes = initializeNodes(inputs);
  let currentEnergy = calculateTotalEnergy(nodes, ctx.costField, ctx.segments, ctx.globalRects);

  let temperature = params.initialTemp;
  let bestNodes = nodes.map(n => ({ ...n }));
  let bestEnergy = currentEnergy;

  while (temperature > params.finalTemp) {
    for (let iter = 0; iter < params.iterationsPerTemp; iter++) {
      const nodeIndex = Math.floor(Math.random() * nodes.length);
      const neighborNode = randomNeighbor(nodes[nodeIndex], params.maxStepSize, ctx.viewport, params.boundsPadding);

      const testNodes = nodes.map((n, i) => i === nodeIndex ? neighborNode : { ...n });
      const neighborEnergy = calculateTotalEnergy(testNodes, ...);

      const deltaE = neighborEnergy - currentEnergy;

      // Metropolis准则
      if (deltaE < 0 || Math.random() < Math.exp(-deltaE / temperature)) {
        nodes = testNodes;
        currentEnergy = neighborEnergy;

        if (currentEnergy < bestEnergy) {
          bestNodes = nodes.map(n => ({ ...n }));
          bestEnergy = currentEnergy;
        }
      }
    }
    temperature *= params.coolingRate;
  }

  nodes = bestNodes;
  // 后处理：强制消除残留重叠
  nodes = resolveOverlaps(nodes);
  return nodes;
}
```

### 2.3 参数配置

```typescript
export type SimAnnealingParams = {
  /** 初始温度 (1000) */
  initialTemp: number;
  /** 终止温度 (0.001) */
  finalTemp: number;
  /** 冷却率 (0.995) */
  coolingRate: number;
  /** 每温度迭代次数 (100) */
  iterationsPerTemp: number;
  /** 最大步长 (50) */
  maxStepSize: number;
  /** 锚点关联强度 (0.5) */
  linkStrength: number;
  /** 边界留白 (10) */
  boundsPadding: number;
};

export const DEFAULT_SIM_ANNEALING: SimAnnealingParams = {
  initialTemp: 1000,
  finalTemp: 0.001,
  coolingRate: 0.995,
  iterationsPerTemp: 100,
  maxStepSize: 50,
  linkStrength: 0.5,
  boundsPadding: 10,
};
```

### 2.4 参数影响说明

| 参数 | 增大效果 | 减小效果 | 推荐范围 |
|------|----------|----------|----------|
| initialTemp | 更充分搜索，可能更优解 | 可能陷入局部最优 | 500 ~ 2000 |
| finalTemp | 更精细解，更慢 | 可能无法充分收敛 | 0.0001 ~ 0.01 |
| coolingRate | 更慢冷却，更优解 | 收敛变慢 | 0.99 ~ 0.999 |
| iterationsPerTemp | 每温度更多尝试 | 计算量增加 | 50 ~ 200 |
| maxStepSize | 更大探索范围 | 可能跳过最优解 | 30 ~ 100 |
| linkStrength | 更靠近锚点 | 更自由分布 | 0.3 ~ 1.0 |

---

## 3. Voronoi+力导向混合布局 (Voronoi+Force Hybrid Layout)

### 3.1 核心思想

混合布局结合了两种方法的优势：
1. **带权Voronoi（Power Diagram）**：基于标签尺寸分配空间，保证公平性
2. **力导向迭代**：精细调整，解决Voronoi无法处理的复杂约束

**"热启动"策略**：用Voronoi位置作为力导向的初始位置，避免力导向从随机位置开始的盲目搜索。

### 3.2 实现细节

#### 带权Voronoi（Power Diagram）

带权Voronoi也称为Power Diagram，每个站点有权重 `weight`，点x到站点i的Power距离为：

```
power_i(x) = |x - site_i|² - weight_i²
```

网格采样法构建Power Diagram：

```typescript
function buildPowerDiagram(nodes: VoronoiNode[], width: number, height: number): Cell[] {
  const gridSize = 20;
  const gridWidth = Math.ceil(width / gridSize);
  const gridHeight = Math.ceil(height / gridSize);

  for (const node of nodes) {
    // 对每个网格点，找到power距离最小的站点
    for (let gy = 0; gy < gridHeight; gy++) {
      for (let gx = 0; gx < gridWidth; gx++) {
        const px = (gx + 0.5) * gridSize;
        const py = (gy + 0.5) * gridSize;

        let minPower = Infinity;
        for (const other of nodes) {
          const dx = px - other.x;
          const dy = py - other.y;
          const dist2 = dx * dx + dy * dy;
          const power = dist2 - other.weight * other.weight;
          if (power < minPower) {
            minPower = power;
            closestNode = other;
          }
        }

        if (closestNode === node) {
          // 该点属于当前节点的cell
          count++;
          sumX += px;
          sumY += py;
        }
      }
    }

    // 计算质心和边界顶点
    const centroidX = sumX / count;
    const centroidY = sumY / count;
    cells.push({ node, centroidX, centroidY, vertices });
  }
  return cells;
}
```

#### 节点权重计算

```typescript
const area = it.width * it.height;
const weight = Math.sqrt(area) * voronoiParams.weightScale;
```

面积开方后再缩放，使大标签获得更大Voronoi单元。

#### 初始位置选择

在Voronoi单元内，选择距离锚点最近的位置：

```typescript
function findInitialPosition(
  cell: Cell,
  anchorX: number,
  anchorY: number
): { x: number; y: number } {
  let bestX = cell.centroidX;
  let bestY = cell.centroidY;
  let bestDist = Math.sqrt((bestX - anchorX)² + (bestY - anchorY)²);

  // 优先选择单元边界上的点
  if (cell.vertices.length > 0) {
    for (const v of cell.vertices) {
      const dist = Math.sqrt((v.x - anchorX)² + (v.y - anchorY)²);
      if (dist < bestDist) {
        bestDist = dist;
        bestX = v.x;
        bestY = v.y;
      }
    }
  }

  return { x: bestX, y: bestY };
}
```

#### 力导向精细调整

以Voronoi位置为起点，运行力导向仿真（与纯力导向相同机制）：

```typescript
const sim = forceSimulation(nodes as any)
  .alpha(alpha)
  .alphaDecay(alphaDecay)
  .alphaMin(alphaMin)
  .force('x', forceX<VoronoiNode>((d) => d.anchorX).strength(linkStrength))
  .force('y', forceY<VoronoiNode>((d) => d.anchorY).strength(linkStrength))
  .force('collide', rectCollideForce(collideStrength))
  .force('field', voronoiFieldRepulsionForce(ctx, voronoiParams))
  .force('bounds', voronoiBoundingForce(ctx, voronoiParams))
  .stop();

// 自适应迭代收敛检测
for (let i = 0; i < MAX_SIM_ITERATIONS; i++) {
  sim.tick();
  if (i >= iterations) {
    const avgMovement = calculateAvgMovement(nodes, prevPositions);
    if (avgMovement < CONVERGENCE_THRESHOLD) break;
  }
}
```

### 3.3 参数配置

**Voronoi参数：**

```typescript
export type VoronoiParams = {
  maxIterations: number;
  collisionIterations: number;
  segmentPadding: number;     // 与线段的安全距离 (12)
  globalPadding: number;      // 与全局矩形的距离 (8)
  boundsPadding: number;      // 视口边界 (10)
  weightScale: number;        // 权重缩放 (0.25)
  anchorStrength: number;     // 锚点吸引力 (0.05)
};

export const DEFAULT_VORONOI: VoronoiParams = {
  maxIterations: 100,
  collisionIterations: 100,
  segmentPadding: 12,
  globalPadding: 8,
  boundsPadding: 10,
  weightScale: 0.25,
  anchorStrength: 0.5,
};
```

**Voronoi+Force独立力导向参数：**

```typescript
export type VoronoiForceParams = {
  linkStrength: number;
  collideStrength: number;
  fieldStrength: number;
  alpha: number;
  alphaDecay: number;
  alphaMin: number;
  iterations: number;
};

export const DEFAULT_VORONOI_FORCE: VoronoiForceParams = {
  linkStrength: 0.12,
  collideStrength: 3.0,
  fieldStrength: 1.5,
  alpha: 0.25,
  alphaDecay: 0.025,
  alphaMin: 0.001,
  iterations: 400,
};
```

### 3.4 参数影响说明

| 参数 | 增大效果 | 减小效果 | 推荐范围 |
|------|----------|----------|----------|
| weightScale | 大标签获得更大空间 | 空间分配更均匀 | 0.15 ~ 0.5 |
| anchorStrength | 更靠近锚点 | 更自由分布 | 0.3 ~ 0.8 |
| segmentPadding | 更宽松线避让 | 标签可能压线 | 8 ~ 20 |
| globalPadding | 更宽松障碍避让 | 标签可能进入障碍 | 5 ~ 15 |
| boundsPadding | 更大边界留白 | 标签更靠近边界 | 5 ~ 20 |

### 3.5 Voronoi+Force力导向参数影响说明

| 参数 | 增大效果 | 减小效果 | 推荐范围 |
|------|----------|----------|----------|
| linkStrength | 标签更靠近锚点 | 标签分布更均匀 | 0.08 ~ 0.2 |
| collideStrength | 碰撞排斥更强 | 可能出现重叠 | 2.0 ~ 4.0 |
| fieldStrength | 更强避开障碍物 | 可能穿过代价场 | 1.0 ~ 2.5 |
| alpha | 更激进迭代 | 收敛更慢 | 0.15 ~ 0.35 |
| alphaDecay | 更快冷却 | 更慢冷却 | 0.02 ~ 0.04 |
| iterations | 更多迭代次数 | 更少迭代 | 300 ~ 600 |

---

## 4. 三种算法对比

### 4.1 核心特性对比

| 特性 | 力导向 | 模拟退火 | Voronoi+力导向 |
|------|--------|---------|----------------|
| 优化方式 | 连续梯度下降 | 离散随机搜索 | 两阶段混合 |
| 初始位置 | 锚点位置或上次结果 | 锚点位置或上次结果 | Voronoi单元位置（热启动）|
| 空间分配 | 依赖力平衡 | 依赖能量函数 | 预先分配（带权Voronoi）|
| 局部最优风险 | 中等 | 较低 | 较低 |
| 计算复杂度 | O(n×k) | O(n×T×iter) | O(n×grid) + O(n×k) |
| 参数敏感性 | 中等 | 高 | 中等 |

### 4.2 适用场景

| 场景 | 推荐算法 |
|------|----------|
| 标签数量少（<20） | 任一均可 |
| 标签数量多（>50） | Voronoi+力导向 |
| 标签尺寸差异大 | Voronoi+力导向 |
| 需要全局最优解 | 模拟退火 |
| 实时迭代更新 | 力导向 |
| 避开复杂障碍物 | 模拟退火 |

### 4.3 能量函数权重对比

| 能量项 | 力导向 | 模拟退火 | Voronoi+力导向 |
|--------|--------|---------|----------------|
| 锚点关联 | linkStrength (0.16) | 0.1 | linkStrength (0.16) |
| 标签重叠 | collideStrength (3.5) | 10 | collideStrength (3.5) |
| 线段重叠 | 硬约束后处理 | 50 | 硬约束后处理 |
| 势场斥力 | fieldStrength (1.8) | 2 | fieldStrength (1.8) |

---

## 5. 代码调用示例

### 5.1 力导向布局

```typescript
import { runForceLayout, DEFAULT_FORCE } from '@/app/agent/layout/forceLayout';

const { outputs, leaderLines } = runForceLayout(
  inputs,  // Array<LayoutItemInput & { anchorPx, prevCenter? }>
  {
    viewport: { width: 1920, height: 1080 },
    costField: costField,
    segments: lineSegments,
    globalRects: globalBounds,
  },
  DEFAULT_FORCE
);
```

### 5.2 模拟退火布局

```typescript
import { runSimulatedAnnealingLayout, DEFAULT_SIM_ANNEALING } from '@/app/agent/simulatedAnnealing/simulatedAnnealingLayout';

const { outputs, leaderLines } = runSimulatedAnnealingLayout(
  inputs,
  {
    viewport: { width: 1920, height: 1080 },
    costField: costField,
    segments: lineSegments,
    globalRects: globalBounds,
  },
  {
    ...DEFAULT_SIM_ANNEALING,
    initialTemp: 1500,
    coolingRate: 0.99,
  }
);
```

### 5.3 Voronoi+力导向混合布局

```typescript
import { runVoronoiForceLayout, DEFAULT_VORONOI, DEFAULT_VORONOI_FORCE } from '@/app/agent/weightedVoronoi/weightedVoronoiLayout';

const { outputs, leaderLines } = runVoronoiForceLayout(
  inputs,
  {
    viewport: { width: 1920, height: 1080 },
    costField: costField,
    segments: lineSegments,
    globalRects: globalBounds,
  },
  {
    ...DEFAULT_VORONOI,
    weightScale: 0.3,
    anchorStrength: 0.6,
  },
  {
    ...DEFAULT_VORONOI_FORCE,
    linkStrength: 0.15,
    collideStrength: 3.5,
  }
);
```

---

## 6. 文件结构

```
web/src/app/agent/
├── layout/
│   ├── forceLayout.ts           # 力导向布局实现
│   ├── costField.ts             # 势场计算
│   ├── rectCollide.ts           # 矩形碰撞力
│   ├── obstacles.ts             # 障碍物类型定义
│   └── types.ts                 # 共享类型定义
├── simulatedAnnealing/
│   └── simulatedAnnealingLayout.ts  # 模拟退火布局实现
└── weightedVoronoi/
    ├── weightedVoronoiLayout.ts     # Voronoi+Force混合布局
    └── types.ts                     # Voronoi相关类型定义
```

---

## 7. 关键数学公式汇总

### 7.1 Power距离
```
power_i(x) = |x - site_i|² - weight_i²
```

### 7.2 Metropolis接受准则
```
P(accept) = min(1, exp(-ΔE / T))
```

### 7.3 温度衰减
```
T_{n+1} = T_n × coolingRate
```

### 7.4 重叠能量
```
E_overlap = overlap_X × overlap_Y × weight
```

### 7.5 碰撞推力
```
F_push = min(overlap_X, overlap_Y) × 0.5
```
