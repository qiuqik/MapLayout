# MapLayout 后端

后端服务，基于 FastAPI + LLM + VLM，提供多模态地图生成功能。

## 技术栈

```
Python 3.10+
FastAPI
LangChain
OpenAI API
Qwen VLM API
AMap API
```

## 项目结构

```
server/
├── src/             # 源代码
│   ├── nodes/       # 节点化处理模块
│   │   ├── geojson_generation.py     # GeoJSON 生成节点
│   │   ├── intent_enrichment.py      # 意图丰富节点
│   │   ├── style_code_generation.py  # 样式代码生成节点
│   │   ├── validation_node.py        # 验证节点
│   │   └── visual_structure.py       # 视觉结构解析节点
│   ├── utils/       # 工具函数
│   │   └── agent_utils.py  # Agent 工具函数
│   ├── multi_modal_agent.py  # 多模态 Agent 主类
│   ├── amap_service.py       # 高德地图服务
│   └── test_agent.py         # Agent 测试脚本
├── app.py           # FastAPI 服务入口
├── .env.example     # 环境变量示例
└── README.md        # 后端说明
```

## 核心功能

1. **多模态地图生成**：
   - 从用户文本和参考图片生成 GeoJSON 数据
   - 生成 Mapbox 样式代码
   - 支持会话管理和错误重试

2. **节点化处理**：
   - **IntentEnrichmentNode**：意图理解与丰富
   - **VisualStructureNode**：视觉元素提取与结构解析
   - **GeoJSONGenerationNode**：数据结构化与拓扑映射
   - **StyleCodeGenerationNode**：样式推演与模板引擎

3. **API 服务**：
   - 提供 RESTful API 接口
   - 支持图片上传
   - 提供文件管理功能

## 运行方法

1. 安装依赖：
   ```bash
   pip install -r requirements.txt
   ```

2. 配置环境变量：
   - 复制 `.env.example` 为 `.env`
   - 填写 API 密钥和代理设置

3. 启动服务：
   ```bash
   python app.py
   ```

4. 服务地址：`http://localhost:8000`

## API 接口

### 1. 多模态 Agent 接口
- **端点**：`POST /api/multimodal/agent`
- **功能**：调用多模态 Agent 生成地图
- **参数**：
  - `message`：用户文本输入
  - `imageFilename`：参考图片文件名
  - `geojsonFilename`：可选，GeoJSON 文件名
- **返回**：
  - `session_id`：会话 ID
  - `session_dir`：会话目录
  - `geofilepath`：生成的 GeoJSON 文件路径
  - `specfilepath`：生成的样式代码文件路径
  - `intent`：意图理解结果

### 2. 会话列表接口
- **端点**：`GET /api/multimodal/sessions`
- **功能**：获取所有多模态会话列表

### 3. 会话详情接口
- **端点**：`GET /api/multimodal/session/{session_id}`
- **功能**：获取指定会话的完整历史数据

### 4. 图片上传接口
- **端点**：`POST /api/upload-image`
- **功能**：上传参考图片
- **返回**：图片文件名

### 5. 文件管理接口
- **端点**：`GET /files/{name}` - 获取文件
- **端点**：`PUT /files/{name}` - 保存 GeoJSON 文件
