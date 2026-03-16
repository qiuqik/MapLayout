# MapLayout 前端

前端旅行规划+地图布局应用，基于 Next.js + React + Mapbox GL。

## 技术栈

```
React 19
Next.js 16
tailwindcss
shadcn-ui（首选）
chakra-ui（备用）
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
│   │   ├── agent/   # Agent 地图模式
│   │   ├── layout.tsx
│   │   └── page.tsx  # 传统地图模式
│   ├── components/  # 组件
│   │   ├── map/     # 传统地图组件
│   │   │   ├── ConnectLine.tsx
│   │   │   ├── InfoCard.tsx
│   │   │   ├── MainLine.tsx
│   │   │   └── MainPoint.tsx
│   │   ├── mapagent/  # Agent 地图组件
│   │   │   ├── renderers/  # 渲染器
│   │   │   ├── utils/      # 工具函数
│   │   │   ├── AgentDialog.tsx
│   │   │   └── TravelMap.tsx
│   │   └── ui/      # UI 组件
│   ├── lib/         # 工具库
│   │   ├── agentMapContext.tsx
│   │   ├── mapContext.tsx
│   │   └── gcl2wgs.tsx
│   └── styles/      # 样式
├── package.json     # 依赖配置
└── README.md        # 前端说明
```

## 核心功能

1. **传统地图模式**：
   - 手动添加地图点和路线
   - 编辑和调整地图元素
   - 实时预览地图效果

2. **Agent 地图模式**：
   - 基于用户文本和参考图片生成地图
   - 支持多模态输入
   - 自动生成 GeoJSON 数据和样式代码

## 运行方法

1. 安装依赖：
   ```bash
   npm install
   ```

2. 启动开发服务器：
   ```bash
   npm run dev
   ```

3. 访问：`http://localhost:3000`

4. 构建生产版本：
   ```bash
   npm run build
   ```

## 关键组件

### 地图组件
- **CoreMap.tsx**：传统地图组件，支持手动编辑
- **TravelMap.tsx**：Agent 地图组件，支持多模态输入

### Agent 相关组件
- **AgentDialog.tsx**：Agent 交互对话框
- **renderers/**：各种地图元素渲染器
  - `PointRenderer.tsx`：点渲染器
  - `RouteRenderer.tsx`：路线渲染器
  - `AreaRenderer.tsx`：区域渲染器
  - `LabelRenderer.tsx`：标签渲染器
  - `CardRenderer.tsx`：卡片渲染器
  - `GlobalRenderer.tsx`：全局渲染器
  - `BaseMapRenderer.tsx`：基础地图渲染器

## 环境配置

### Mapbox Access Token
需要在前端代码中配置 Mapbox Access Token，可在 `src/components/mapagent/TravelMap.tsx` 中设置。

### 后端服务
前端默认连接到 `http://localhost:8000` 的后端服务，确保后端服务已启动。

## API 调用

前端通过以下 API 与后端交互：
- `POST /api/upload-image`：上传参考图片
- `POST /api/multimodal/agent`：调用多模态 Agent 生成地图
- `GET /geofiles`：获取 GeoJSON 文件列表
- `GET /stylefiles`：获取样式文件列表
- `GET /files/{name}`：获取指定文件内容

## 注意事项

1. 需要配置有效的 Mapbox Access Token
2. 确保后端服务正常运行
3. 上传的图片会存储在后端的 `images` 目录中
4. 生成的 GeoJSON 和样式文件会存储在后端的 `output` 目录中