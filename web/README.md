# MapLayout 前端

前端多模态地图生成应用，基于 Next.js + React + Mapbox GL。

## 技术栈

```
React 19
Next.js 16
tailwindcss
shadcn-ui
chakra-ui
Mapbox GL
react-map-gl
echarts
```

## 项目结构

```
web/
├── public/          # 静态资源
├── src/             # 源代码
│   ├── app/         # Next.js 应用路由
│   │   ├── agent/   # Agent 地图模式 (主模式)
│   │   ├── layout.tsx
│   │   └── page.tsx  # 自动跳转到 /agent
│   ├── components/  # 组件
│   │   └── mapagent/  # Agent 地图组件
│   │       ├── renderers/  # 渲染器
│   │       │   ├── AreaRenderer.tsx
│   │       │   ├── BaseMapRenderer.tsx
│   │       │   ├── CardRenderer.tsx
│   │       │   ├── GlobalRenderer.tsx
│   │       │   ├── LabelRenderer.tsx
│   │       │   ├── PointRenderer.tsx
│   │       │   └── RouteRenderer.tsx
│   │       ├── utils/
│   │       │   └── mapUtils.ts
│   │       ├── AgentDialog.tsx
│   │       ├── DebugOverlay.tsx
│   │       ├── ForceParamsPanel.tsx
│   │       └── TravelMap.tsx
│   ├── lib/         # 工具库
│   │   ├── agentMapContext.tsx
│   │   ├── api.ts
│   │   └── utils.ts
│   └── styles/      # 样式
├── package.json     # 依赖配置
└── README.md        # 前端说明
```

## 核心功能

- **多模态输入**：支持用户文本和参考图片生成地图
- **自动布局**：基于力导向算法自动计算元素位置
- **丰富渲染器**：支持 Point、Route、Area、Label、Card、Global 等多种地图元素

## 运行方法

1. 安装依赖：
   ```bash
   npm install
   ```

2. 启动开发服务器：
   ```bash
   npm run dev
   ```

3. 访问：`http://localhost:3000`（自动跳转到 `/agent`）

4. 构建生产版本：
   ```bash
   npm run build
   ```

## 关键组件

### Agent 地图组件
- **TravelMap.tsx**：主地图组件，集成所有渲染器和布局算法
- **AgentDialog.tsx**：Agent 交互对话框
- **ForceParamsPanel.tsx**：力导向布局参数面板
- **DebugOverlay.tsx**：调试覆盖层

### 渲染器 (renderers/)
- **PointRenderer.tsx**：点标记渲染器
- **RouteRenderer.tsx**：路线渲染器
- **AreaRenderer.tsx**：区域渲染器
- **LabelRenderer.tsx**：文本标签渲染器
- **CardRenderer.tsx**：信息卡片渲染器
- **GlobalRenderer.tsx**：全局元素渲染器
- **BaseMapRenderer.tsx**：基础地图样式渲染器

## 环境配置

### Mapbox Access Token
需要在 `.env.local` 或环境变量中配置 `NEXT_PUBLIC_MAPBOX_TOKEN`。

### API 配置
前端默认连接 `http://localhost:8000`，可通过 `NEXT_PUBLIC_API_BASE_URL` 修改。
