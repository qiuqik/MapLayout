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
│   │   └── visual_structure.py       # 视觉结构解析节点
│   ├── utils/       # 工具函数
│   │   ├── agent_utils.py  # Agent 工具函数
│   │   └── geo_utils.py    # 地理相关工具函数
│   ├── multi_modal_agent.py  # 多模态 Agent 主类
│   ├── travel_agent.py       # 原始 LLM 方法（文本规划）
│   ├── vlm_agent.py          # 原始 LLM 方法（视觉样式）
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

### 2. 原始 LLM 方法接口
- **端点**：`POST /api/agent`
- **功能**：使用原始 LLM 方法生成地图
- **参数**：
  - `message`：用户文本输入
  - `imageFilename`：参考图片文件名
- **返回**：
  - `geofilepath`：生成的 GeoJSON 文件路径
  - `stylefilepath`：生成的样式文件路径

### 3. 图片上传接口
- **端点**：`POST /api/upload-image`
- **功能**：上传参考图片
- **参数**：
  - `file`：图片文件
- **返回**：
  - `filepath`：上传后的文件路径

### 4. 文件管理接口
- **端点**：`GET /geofiles`
- **功能**：获取 GeoJSON 文件列表

- **端点**：`GET /stylefiles`
- **功能**：获取样式文件列表

- **端点**：`GET /mapboxspecfiles`
- **功能**：获取 Mapbox 样式规范文件列表

- **端点**：`GET /files/{name}`
- **功能**：获取指定文件内容

- **端点**：`PUT /files/{name}`
- **功能**：更新 GeoJSON 文件

### 5. 会话管理接口
- **端点**：`GET /api/multimodal/sessions`
- **功能**：列出所有多模态会话

- **端点**：`GET /api/multimodal/session/{session_id}`
- **功能**：获取指定会话的完整历史

- **端点**：`POST /api/multimodal/retry`
- **功能**：重试 GeoJSON 生成

## 环境配置

### .env 文件示例

```env
# OpenAI API 配置
OPENAI_API_KEY=your_openai_api_key
LLM_MODEL=gpt-4o
HTTP_PROXY=http://your_proxy:port

# Qwen VLM API 配置
QwenVLM_API_KEY=your_qwen_vlm_api_key

# 高德地图 API 配置
AMAP_API_KEY=your_amap_api_key
```

## 工作流程

1. **输入处理**：接收用户文本和参考图片
2. **并行处理**：
   - 意图理解（Node 1）
   - 视觉结构解析（Node 2）
3. **数据生成**：
   - GeoJSON 生成（Node 3）
   - 样式代码生成（Node 4）
4. **结果返回**：返回生成的 GeoJSON 和样式代码
5. **会话存储**：将所有中间结果存储在会话目录中

## 注意事项

1. 需要配置有效的 API 密钥（OpenAI、Qwen VLM、AMap）
2. 后端服务需要代理设置以访问外部 API
3. 生成的文件存储在 `output/` 目录中
4. 会话目录格式：`output/{timestamp}_{session_id}`
5. 每个节点的输出存储在对应的子目录中：`node1`、`node2`、`node3`、`node4`