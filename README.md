# MapLayout

多模态地图生成系统，结合文本理解和视觉样式迁移技术。

## 项目结构

```
MapLayout/
├── server/           # 后端服务
├── web/             # 前端应用
└── README.md        # 项目说明
```

## 核心功能

- **多模态地图生成**：从用户输入生成地图数据和样式
- **智能处理**：结合文本理解和视觉分析
- **用户友好界面**：提供直观的地图编辑和预览功能

## 运行方法

### 前端
1. 进入 web 目录：`cd web`
2. 安装依赖：`npm install`
3. 启动服务：`npm run dev`
4. 访问：`http://localhost:3000`

### 后端
1. 进入 server 目录：`cd server`
2. 安装依赖：`pip install -r requirements.txt`
3. 配置环境变量（参考 .env.example）
4. 启动服务：`python app.py`
5. 服务地址：`http://localhost:8000`

## 技术栈

- **前端**：Next.js, React, Mapbox GL
- **后端**：FastAPI, Python, LLM

## 注意事项

- 需要配置相关 API 密钥
- 确保网络连接正常
- 详细文档请参考各目录下的 README 文件