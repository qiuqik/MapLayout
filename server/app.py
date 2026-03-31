from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
import os
import json
import asyncio

from fastapi import UploadFile, File, Body
from datetime import datetime
from src.multi_modal_agent import MultiModalMapAgent

app = FastAPI()

origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class MapAgentRequest(BaseModel):
    message: str
    imageFilename: str
    geojsonFilename: str | None = None


# 返回所有 geojson 文件
@app.get("/geofiles")
async def list_geo_files():
    base = os.path.join(os.path.dirname(__file__), 'output/geojson')
    try:
        files = [f for f in os.listdir(base) if f.endswith('.json')]
    except Exception:
        files = []
    return {"files": files}

# 返回所有 stylejson 文件
@app.get("/stylefiles")
async def list_style_files():
    base = os.path.join(os.path.dirname(__file__), 'output/stylejson')
    try:
        files = [f for f in os.listdir(base) if f.endswith('.json')]
    except Exception:
        files = []
    return {"files": files}

# 返回所有 mapbox_spec 文件
@app.get("/mapboxspecfiles")
async def list_mapbox_spec_files():
    base = os.path.join(os.path.dirname(__file__), 'output/mapbox_spec')
    try:
        files = [f for f in os.listdir(base) if f.endswith('.json')]
    except Exception:
        files = []
    return {"files": files}



# 保存 geojson 文件
@app.put("/files/{name}")
async def save_geojson_file(name: str, content: dict = Body(...)):
    base_path = os.path.dirname(__file__)
    geojson_path = os.path.join(base_path, 'output', 'geojson', name)
    if 'geojson' not in name:
        return JSONResponse(status_code=400, content={"error": "只能更新 geojson 文件"})
    if not os.path.isfile(geojson_path):
        return JSONResponse(status_code=404, content={"error": "文件不存在"})
    try:
        with open(geojson_path, 'w', encoding='utf-8') as f:
            json.dump(content, f, ensure_ascii=False, indent=4)
        return {"success": True, "message": "保存成功"}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


# 返回指定文件，包括 geojson/stylejson/images
@app.get("/files/{name}")
async def get_file(name: str):
    base_path = os.path.dirname(__file__)
    geojson_path = os.path.join(base_path, 'output/geojson', name)
    stylejson_path = os.path.join(base_path, 'output/stylejson', name)
    image_path = os.path.join(base_path, 'images', name)
    mapbox_spec_path = os.path.join(base_path, 'output/mapbox_spec', name)

    # geojson
    if os.path.isfile(geojson_path):
        try:
            with open(geojson_path, 'r', encoding='utf-8') as fh:
                data = json.load(fh)
            return data
        except Exception:
            return JSONResponse(status_code=500, content={"error": "cannot read file"})
    
    # mapbox spec (多模态输出)
    if os.path.isfile(mapbox_spec_path):
        try:
            with open(mapbox_spec_path, 'r', encoding='utf-8') as fh:
                data = json.load(fh)
            return data
        except Exception:
            return JSONResponse(status_code=500, content={"error": "cannot read file"})

    # stylejson
    if os.path.isfile(stylejson_path):
        try:
            with open(stylejson_path, 'r', encoding='utf-8') as fh:
                data = json.load(fh)
            return data
        except Exception:
            return JSONResponse(status_code=500, content={"error": "cannot read file"})

    # image
    if os.path.isfile(image_path):
        return FileResponse(image_path)
    
    return JSONResponse(status_code=404, content={"error": "not found"})



# 图片上传接口
@app.post("/api/upload-image")
async def upload_image(file: UploadFile = File(...)):
    try:
        output_dir = os.path.join(os.path.dirname(__file__), 'images')
        os.makedirs(output_dir, exist_ok=True)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        file_extension = os.path.splitext(file.filename)[1]
        filename = f"image_{timestamp}{file_extension}"
        filepath = os.path.join(output_dir, filename)
        
        # 保存文件
        content = await file.read()
        with open(filepath, 'wb') as f:
            f.write(content)
        
        return {
            "filepath": filename
        }
    except Exception as e:
        return JSONResponse(
            status_code=500, 
            content={"error": f"图片上传失败: {str(e)}"}
        )


@app.post('/api/multimodal/agent')
async def multimodal_agent(request: MapAgentRequest):
    """多模态地图生成 Agent 一站式流程
    
    输入: 用户文本 + 参考图片
    输出: GeoJSON + Mapbox 样式代码
    
    完整流程:
    - 节点 A: 意图理解 (Intent Enrichment)
    - 节点 B: 视觉元素提取 (Visual Feature Extraction)
    - 节点 C: GeoJSON 生成 (GeoJSON Generation)
    - 节点 D: Style Code 生成 (Style Code Generation)
    """
    user_input = request.message
    image_name = request.imageFilename
    
    print("=" * 60)
    print("🚀 启动多模态地图生成 Agent")
    print(f"   用户需求: {user_input[:50]}...")
    print(f"   参考图片: {image_name}")
    print("=" * 60)
    
    image_path = None
    if image_name:
        image_path = os.path.join(os.path.dirname(__file__), 'images', image_name)
        if not os.path.exists(image_path):
            return JSONResponse(status_code=404, content={"error": f"图片文件不存在：{image_path}"})
    
    def run_multimodal_agent():
        output_dir = os.path.join(os.path.dirname(__file__), 'output')
        agent = MultiModalMapAgent(output_dir)
        result = agent.run(user_text=user_input, image_path=image_path)
        return result
    
    try:
        result = await asyncio.to_thread(run_multimodal_agent)
        
        if "error" in result:
            return JSONResponse(status_code=500, content={"error": result["error"]})
        
        session_dir = result.get("session_dir", "")
        geojson_basename = None
        style_basename = None
        
        if "geojson" in result:
            geojson_data = result["geojson"]
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            geojson_filename = f"geojson_{timestamp}.json"
            
            geojson_dir = os.path.join(os.path.dirname(__file__), 'output/geojson')
            os.makedirs(geojson_dir, exist_ok=True)
            geojson_path = os.path.join(geojson_dir, geojson_filename)
            
            with open(geojson_path, "w", encoding="utf-8") as f:
                json.dump(geojson_data, f, ensure_ascii=False, indent=2)
            geojson_basename = geojson_filename
        
        if "style_code" in result:
            style_data = result["style_code"]
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            style_filename = f"style_{timestamp}.json"
            
            style_dir = os.path.join(os.path.dirname(__file__), 'output/mapbox_spec')
            os.makedirs(style_dir, exist_ok=True)
            style_path = os.path.join(style_dir, style_filename)
            
            with open(style_path, "w", encoding="utf-8") as f:
                json.dump(style_data, f, ensure_ascii=False, indent=2)
            style_basename = style_filename
        
        print("=" * 60)
        print("✅ 多模态地图生成完成!")
        print(f"   会话目录: {session_dir}")
        print("=" * 60)
        
        return {
            "session_id": result.get("session_id"),
            "session_dir": session_dir,
            "geofilepath": geojson_basename,
            "specfilepath": style_basename,
            "intent": result.get("intent"),
            "validation": result.get("validation")
        }
        
    except Exception as e:
        print(f"❌ 多模态 Agent 执行失败: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/api/multimodal/sessions")
async def list_multimodal_sessions():
    """列出所有多模态会话"""
    base = os.path.join(os.path.dirname(__file__), 'output')
    try:
        sessions = []
        for item in os.listdir(base):
            item_path = os.path.join(base, item)
            if os.path.isdir(item_path) and ("_" in item or "session" in item):
                sessions.append({
                    "session_id": item,
                    "path": item_path,
                    "created": item.split("_")[0] if "_" in item else "unknown"
                })
        sessions.sort(key=lambda x: x["created"], reverse=True)
    except Exception:
        sessions = []
    return {"sessions": sessions}


@app.get("/api/multimodal/session/{session_id}")
async def get_multimodal_session(session_id: str):
    """获取指定会话的完整历史"""
    base = os.path.join(os.path.dirname(__file__), 'output', session_id)
    if not os.path.exists(base):
        return JSONResponse(status_code=404, content={"error": "会话不存在"})

    node3_path = os.path.join(base, 'node3')
    node4_path = os.path.join(base, 'node4')

    layout_files, groundtruth_files, origin_files = [], [], []

    if os.path.exists(node3_path):
        for f in os.listdir(node3_path):
            if not f.endswith('.json'):
                continue
            filepath = os.path.join(node3_path, f)
            try:
                with open(filepath, "r", encoding="utf-8") as file:
                    data = json.load(file)
                    entry = {"filename": f, "data": data}
                    if 'groundtruth' in f.lower():
                        groundtruth_files.append(entry)
                    elif 'layout' in f.lower():
                        layout_files.append(entry)
                    else:
                        origin_files.append(entry)
            except Exception as e:
                print(f"⚠️ 读取文件失败: {filepath}, 错误: {e}")

    layout_files.sort(key=lambda x: x['filename'])
    groundtruth_files.sort(key=lambda x: x['filename'])
    origin_files.sort(key=lambda x: x['filename'])

    style_code = None
    if os.path.exists(node4_path):
        files = sorted([f for f in os.listdir(node4_path) if f.endswith('.json')])
        if files:
            try:
                with open(os.path.join(node4_path, files[-1]), "r", encoding="utf-8") as f:
                    style_code = json.load(f)
            except Exception as e:
                print(f"⚠️ 读取 node4 失败: {e}")

    return {
        "session_id": session_id,
        "style_code": style_code,
        "origin_file": origin_files[-1] if origin_files else None,
        "has_origin": len(origin_files) > 0,
        "layout_file": layout_files[-1] if layout_files else (origin_files[-1] if origin_files else None),
        "has_layout": len(layout_files) > 0,
        "groundtruth_file": groundtruth_files[-1] if groundtruth_files else (layout_files[-1] if layout_files else (origin_files[-1] if origin_files else None)),
        "has_groundtruth": len(groundtruth_files) > 0,
    }


def get_unique_filepath(directory: str, base_filename: str) -> str:
    """Generate a unique filepath by appending 01, 02, 03 etc. if file exists"""
    name, ext = os.path.splitext(base_filename)
    filepath = os.path.join(directory, base_filename)

    if not os.path.exists(filepath):
        return filepath

    counter = 1
    while True:
        new_filename = f"{name}_{counter:02d}{ext}"
        new_filepath = os.path.join(directory, new_filename)
        if not os.path.exists(new_filepath):
            return new_filepath
        counter += 1
        if counter > 999:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            return os.path.join(directory, f"{name}_{timestamp}{ext}")


@app.post('/api/multimodal/session/{session_id}/save')
async def save_session_geojson(session_id: str, request: dict):
    """保存 geojson 数据到 session，支持 origin/layout/groundtruth 分类"""
    base = os.path.join(os.path.dirname(__file__), 'output', session_id)
    if not os.path.exists(base):
        return JSONResponse(status_code=404, content={"error": "会话不存在"})

    try:
        geojson_data = request.get('geojson')
        if geojson_data is None:
            return JSONResponse(status_code=400, content={"error": "缺少 geojson 数据"})

        category = request.get('category', 'origin')
        node3_path = os.path.join(base, 'node3')
        os.makedirs(node3_path, exist_ok=True)

        filename = request.get('filename')
        if filename:
            filepath = get_unique_filepath(node3_path, filename)
        else:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            prefix_map = {
                'layout': 'geojson_layout',
                'groundtruth': 'geojson_groundtruth',
            }
            prefix = prefix_map.get(category, 'geojson')
            filepath = os.path.join(node3_path, f"{prefix}_{timestamp}.json")

        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(geojson_data, f, ensure_ascii=False, indent=2)

        return {"success": True, "session_id": session_id, "filepath": filepath}
    except Exception as e:
        print(f"❌ 保存 Session Geojson 失败: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post('/api/multimodal/session/{session_id}/mapinfo')
async def save_session_mapinfo(session_id: str, request: dict):
    """保存地图视图信息到 session/mapInfo.json"""
    base = os.path.join(os.path.dirname(__file__), 'output', session_id)
    if not os.path.exists(base):
        return JSONResponse(status_code=404, content={"error": "会话不存在"})

    try:
        mapinfo_data = request.get('mapInfo')
        if mapinfo_data is None:
            return JSONResponse(status_code=400, content={"error": "缺少 mapInfo 数据"})

        filepath = os.path.join(base, 'mapInfo.json')
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(mapinfo_data, f, ensure_ascii=False, indent=2)

        return {"success": True, "session_id": session_id, "filepath": filepath}
    except Exception as e:
        print(f"❌ 保存 MapInfo 失败: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post('/api/multimodal/retry')
async def multimodal_retry(request: MapAgentRequest):
    """重试机制: 当 GeoJSON 生成失败时，重新进行意图理解和 GeoJSON 生成"""
    user_input = request.message
    
    print("=" * 60)
    print("🔄 触发重试机制")
    print(f"   用户需求: {user_input[:50]}...")
    print("=" * 60)
    
    def run_with_retry():
        output_dir = os.path.join(os.path.dirname(__file__), 'output')
        agent = MultiModalMapAgent(output_dir)
        
        state = agent.intent_node.execute(
            type('AgentState', (), {
                'user_text': user_input,
                'intent_enriched': None,
                'error': None
            })()
        )
        
        if state.error:
            return {"error": state.error}
        
        state = agent.geojson_node.execute(
            type('AgentState', (), {
                'intent_enriched': state.intent_enriched,
                'visual_features': {},
                'geojson_data': None,
                'error': None,
                'retry_count': 0
            })()
        )
        
        if state.error:
            return {"error": state.error, "retry_count": state.retry_count}
        
        return {"geojson": state.geojson_data, "intent": state.intent_enriched}
    
    try:
        result = await asyncio.to_thread(run_with_retry)
        
        if "error" in result:
            return JSONResponse(status_code=500, content={
                "error": result["error"],
                "retry_count": result.get("retry_count", 0)
            })
        
        return {
            "geojson": result.get("geojson"),
            "intent": result.get("intent")
        }
        
    except Exception as e:
        print(f"❌ 重试机制执行失败: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
