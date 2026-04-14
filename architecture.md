# MapLayout 架构文档

## 项目概述
**多模态地图生成系统**：结合文本理解（LLM）和视觉样式迁移（VLM）技术，从用户输入的旅游需求和参考图片，自动生成地图数据（GeoJSON）和样式代码（Mapbox Spec）。

---

## 一、evaluate（评估模块）

用于量化评估地图生成算法的质量，提供 7 大指标。

### 核心文件

| 文件 | 功能 |
|------|------|
| `index.py` | 评估主入口，计算 7 项指标 |
| `vllm.py` | VLM 评判模型（美观性评估） |

### 7 大评估指标

| 指标 | 说明 | 方向 |
|------|------|------|
| **Overlap** | 布局重叠度（标签与标签、标签与地理要素的遮挡） | 越低越好 |
| **Utility** | 空间利用率（6×10 网格中有多少被占用） | 越高越好 |
| **Balance** | 空间平衡性（3×5 网格密度标准差转换） | 越高越好 |
| **MeanIoU** | 与 Ground Truth 的平均相似性（含中心点距离容忍） | 越高越好 |
| **Aesthetics** | 美观性（VLM 对比 layout.jpg 与 gt.jpg 的胜率） | 越高越好 |
| **Stability** | 算法稳定性（多次运行结果的平均两两 IoU） | 越高越好 |
| **MeanTime** | 算法平均耗时 | 越低越好 |

### Session 类
- 解析会话目录下的 `node3` 中的 origin/groundtruth/layout GeoJSON
- 将经纬度坐标转换为 1500×900 像素坐标
- 生成黑白 Mask 图用于空间利用率/平衡性计算
- 计算并保存评估结果到 `result/` 目录

---

## 二、server（后端服务）

基于 **FastAPI + LangGraph** 的多模态 Agent 系统，核心架构为 **5 节点 DAG 状态机**。

### 核心文件

| 文件 | 功能 |
|------|------|
| `app.py` | FastAPI 主应用，定义所有 REST API |
| `src/multi_modal_agent.py` | Agent 主类，LangGraph 流程编排 |
| `src/amap_service.py` | 高德地图 POI 搜索 API |
| `src/utils.py` | GCJ-02 ↔ WGS84 坐标转换 |

### 五大核心节点 (`src/nodes/`)

| 节点 | 模型 | 输入 | 输出 |
|------|------|------|------|
| **Node 1: 意图丰富** | GPT-5/o1 (LLM) | 用户文本 | 丰富后的意图、全局标题/描述 |
| **Node 2: 视觉结构解析** | Qwen-VL/Gemini (VLM) | 参考图片 | 8 类视觉组件（BaseMap/Point/Area/Route/Label/Card/Edge/Global） |
| **Node 3: GeoJSON 生成** | GPT-5/o1 (LLM) | Node 1 + Node 2 输出 | 标准 GeoJSON FeatureCollection |
| **Node 4: 样式代码生成** | VLM | 参考图 + 视觉结构 + GeoJSON | Mapbox 样式字典 |
| **Node 5: 质量验证** | GPT-5/o1 (LLM) | Node 3 输出 | 验证结果 + 反馈（未通过则打回 Node 3，最多 3 次） |

### 状态流转图

```
InitParallel (Node1 + Node2 并发)
     │
     ▼
GeoJSON (Node 3)
     │
     ▼
Validate (Node 5) ── 未通过 → Node 3 重试 (≤3次)
     │ 通过
     ▼
Style (Node 4)
     │
     ▼
   END
```

### API 端点 (`app.py`)

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/multimodal/agent` | POST | 一站式生成地图（核心入口） |
| `/api/multimodal/sessions` | GET | 获取历史会话列表 |
| `/api/multimodal/session/{id}` | GET | 获取会话完整历史 |
| `/api/multimodal/session/{id}/save` | POST | 保存 GeoJSON 到会话 |
| `/api/multimodal/session/{id}/mapinfo` | POST | 保存地图视图信息 |
| `/api/multimodal/retry` | POST | 重试机制（重新意图理解+GeoJSON 生成） |
| `/api/upload-image` | POST | 上传参考图片 |
| `/geofiles` | GET | 列出所有 GeoJSON 文件 |
| `/stylefiles` | GET | 列出所有样式文件 |
| `/files/{name}` | GET | 获取指定文件（geojson/stylejson/image） |

---

## 三、web（前端应用）

基于 **Next.js + React + Mapbox GL** 的交互式地图生成界面。

### 目录结构

```
web/src/
├── app/                    # Next.js 页面
│   ├── agent/page.tsx      # 主页面
│   └── agent/layout/       # 布局算法模块（力导向）
├── components/
│   ├── mapagent/           # 地图 Agent 核心组件
│   │   ├── TravelMap.tsx   # 地图主组件
│   │   ├── AgentDialog.tsx # 输入对话框
│   │   └── renderers/      # 渲染器
│   └── ui/                 # 基础 UI 组件
└── lib/
    ├── api.ts              # API 集成层
    └── agentMapContext.tsx # 全局状态管理
```

### 核心组件

| 组件 | 功能 |
|------|------|
| `TravelMap.tsx` | Mapbox 地图主组件，协调所有渲染器 |
| `AgentDialog.tsx` | 用户上传参考图片 + 输入旅游需求 |
| `ForceParamsPanel.tsx` | 力导向布局参数调节面板 |
| `DatasetPanel.tsx` | 数据集模式切换（origin/layout/groundtruth） |
| `DraggableOutput.tsx` | 可拖拽输出组件 |
| `DebugOverlay.tsx` | 代价场可视化调试层 |

### 渲染器 (`renderers/`)

| 渲染器 | 功能 |
|--------|------|
| `BaseMapRenderer` | 底图样式（blank/standard/satellite） |
| `AreaRenderer` | 多边形区域填充 |
| `RouteRenderer` | 路线渲染（支持曲线/直线） |
| `PointRenderer` | 点要素渲染 |
| `CardRenderer` | 卡片标记（Marker + HTML） |
| `LabelRenderer` | 标签渲染 |
| `GlobalRenderer` | 全局元素（标题面板等） |

### 布局算法模块 (`app/agent/layout/`)

| 文件 | 功能 |
|------|------|
| `forceLayout.ts` | 力导向布局核心算法（基于 d3-force） |
| `costField.ts` | 代价场构建与采样 |
| `obstacles.ts` | 障碍物矩形和线段构建 |
| `rectCollide.ts` | 矩形碰撞检测 |
| `types.ts` | 类型定义 |

### 状态管理

`AgentMapContext.tsx` 提供全局状态：
- `specfilename`：样式文件名
- `manifest`：样式清单
- `geojson`：GeoJSON 数据
- 支持三种数据集模式切换

### API 集成

前端通过 `lib/api.ts` 调用后端 REST API，实现：
- 提交 Agent 请求（文本 + 图片）
- 加载/保存会话
- 获取 GeoJSON 和样式文件
- 上传参考图片

---

## 技术栈汇总

| 层级 | 技术 |
|------|------|
| **前端** | Next.js, React, Mapbox GL, react-map-gl, Chakra UI, d3-force, coordtransform |
| **后端** | FastAPI, LangGraph, LangChain, OpenAI API, Qwen-VL, Gemini, 高德地图 API |
| **评估** | Python, Shapely, OpenCV, NumPy, PIL, VLM Judge |
