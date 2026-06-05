from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
import os
import json
import asyncio
import re
import requests
import uuid

from fastapi import UploadFile, File, Body
from datetime import datetime
from src.agent_events import AgentEvent
from src.multi_modal_agent import MultiModalMapAgent
from src.run_store import run_store
from src.utils.coord_transform import gcj02_to_wgs84
from src.utils.agent_utils import AgentState

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
except Exception:
    pass

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


class CreateRunRequest(BaseModel):
    message: str
    imageFilename: str = ""
    geojsonFilename: str | None = None


class RerunDownstreamRequest(BaseModel):
    node_id: str
    payload: dict


class NavigationRouteRequest(BaseModel):
    coordinates: list[list[float]]


class LabelOptimizationRequest(BaseModel):
    screenshot: str | None = None
    viewport: dict | None = None
    geojson: dict | None = None
    style_code: dict | None = None
    layout: dict | None = None
    max_rounds: int = 3


def _resolve_multimodal_session_dir(session_id: str) -> str | None:
    """Resolve either an exact output folder name or a raw run/session id suffix."""
    base = os.path.join(os.path.dirname(__file__), 'output')
    exact = os.path.join(base, session_id)
    if os.path.isdir(exact):
        return exact
    try:
        matches = [
            os.path.join(base, item)
            for item in os.listdir(base)
            if os.path.isdir(os.path.join(base, item)) and item.endswith(f"_{session_id}")
        ]
    except Exception:
        matches = []
    return sorted(matches)[-1] if matches else None


def _load_latest_session_json(session_dir: str, subdir: str) -> dict | None:
    target = os.path.join(session_dir, subdir)
    if not os.path.isdir(target):
        return None
    files = sorted(
        [name for name in os.listdir(target) if name.endswith('.json')],
        key=lambda name: (os.path.getmtime(os.path.join(target, name)), name),
    )
    if not files:
        return None
    with open(os.path.join(target, files[-1]), "r", encoding="utf-8") as f:
        return json.load(f)


def _convert_coordinates(coords):
    """递归转换 GeoJSON 中所有坐标从 GCJ-02 到 WGS84"""
    if isinstance(coords[0], (int, float)):
        # 单个坐标点 [lng, lat]
        return list(gcj02_to_wgs84(coords[0], coords[1]))
    elif isinstance(coords[0], list):
        # 嵌套坐标（LineString 或多边形环）
        return [_convert_coordinates(c) for c in coords]
    return coords


def _fetch_walking_route(coordinates, token):
    """调用 Mapbox Directions API 获取步行路线"""
    MAX_WAYPOINTS = 5

    if len(coordinates) <= 2:
        return coordinates

    # 处理超过最大航点数的情况
    if len(coordinates) > MAX_WAYPOINTS:
        all_coords = []
        for i in range(len(coordinates) - 1):
            segment = coordinates[i:i+2]
            segment_route = _fetch_single_route(segment, token)
            if all_coords:
                all_coords.extend(segment_route[1:])  # 避免重复连接点
            else:
                all_coords.extend(segment_route)
        return all_coords

    return _fetch_single_route(coordinates, token)


def _fetch_single_route(coordinates, token):
    """获取单段步行路线"""
    try:
        coords = ';'.join([f"{c[0]},{c[1]}" for c in coordinates])
        url = f"https://api.mapbox.com/directions/v5/mapbox/walking/{coords}?geometries=geojson&access_token={token}"
        
        if len(url) > 2000:
            return coordinates
        
        res = requests.get(url, timeout=15)
        if not res.ok:
            return coordinates
        
        data = res.json()
        route_coords = data.get('routes', [{}])[0].get('geometry', {}).get('coordinates')
        return route_coords if route_coords else coordinates
    except Exception:
        return coordinates


def _get_mapbox_token() -> str | None:
    """Read Mapbox token from backend or shared frontend env names."""
    return (
        os.getenv("MAPBOX_TOKEN")
        or os.getenv("NEXT_PUBLIC_MAPBOX_TOKEN")
        or os.getenv("MAPBOX_ACCESS_TOKEN")
    )


def process_geojson_for_frontend(geojson_data, style_code=None):
    """处理 GeoJSON 数据：转换坐标并根据 style_code 判断是否获取步行路线"""
    if not geojson_data or 'features' not in geojson_data:
        return geojson_data

    mapbox_token = _get_mapbox_token()
    processed = json.loads(json.dumps(geojson_data))  # 深拷贝

    # 从 style_code 中提取 Route 配置，构建 visual_id -> style 映射
    route_style_map = {}
    if style_code and 'Route' in style_code:
        for route_style in style_code['Route']:
            visual_id = route_style.get('visual_id')
            style_type = route_style.get('style')
            if visual_id and style_type:
                route_style_map[visual_id] = style_type

    for feature in processed.get('features', []):
        geom_type = feature.get('geometry', {}).get('type')
        coords = feature.get('geometry', {}).get('coordinates')
        if not coords:
            continue

        # 转换所有坐标
        feature['geometry']['coordinates'] = _convert_coordinates(coords)

        # 处理 LineString 的步行路线
        if geom_type == 'LineString' and mapbox_token:
            visual_id = feature.get('properties', {}).get('visual_id')
            # 只有当 style 为 navigation 时才调用 Mapbox API。
            if route_style_map.get(visual_id) == 'navigation':
                original_coords = feature['geometry']['coordinates']
                if len(original_coords) > 2:
                    walking_route = _fetch_walking_route(original_coords, mapbox_token)
                    feature['geometry']['coordinates'] = walking_route

        # 转换 label_coord
        props = feature.get('properties', {})
        if 'label_coord' in props and isinstance(props['label_coord'], list):
            props['label_coord'] = list(gcj02_to_wgs84(props['label_coord'][0], props['label_coord'][1]))

    return processed


@app.post("/api/multimodal/route/navigation")
async def build_navigation_route(request: NavigationRouteRequest):
    """Return walking-route geometry for an already WGS84 LineString."""
    coordinates = request.coordinates or []
    if len(coordinates) < 2:
        return JSONResponse(status_code=400, content={"error": "coordinates must contain at least two positions"})

    mapbox_token = _get_mapbox_token()
    if not mapbox_token:
        return {
            "coordinates": coordinates,
            "source": "fallback",
            "warning": "Mapbox token is not configured; set MAPBOX_TOKEN or NEXT_PUBLIC_MAPBOX_TOKEN on the backend process",
        }

    route_coords = _fetch_walking_route(coordinates, mapbox_token)
    return {
        "coordinates": route_coords,
        "source": "mapbox" if route_coords != coordinates else "fallback",
    }


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


@app.post("/api/multimodal/runs")
async def create_multimodal_run(request: CreateRunRequest):
    """Create an observable multi-modal Agent run and stream progress via SSE."""
    image_path = None
    if request.imageFilename:
        image_path = os.path.join(os.path.dirname(__file__), 'images', request.imageFilename)
        if not os.path.exists(image_path):
            return JSONResponse(status_code=404, content={"error": f"图片文件不存在：{image_path}"})

    run_id = f"run_{uuid.uuid4().hex[:12]}"
    record = run_store.create(run_id)
    loop = asyncio.get_running_loop()

    def enqueue_event(event_type: str, event_data: dict | None = None) -> None:
        event_data = event_data or {}
        event_model = AgentEvent(
            type=event_type,
            run_id=run_id,
            session_id=event_data.get("session_id"),
            node_id=event_data.get("node_id"),
            label=event_data.get("label"),
            status=event_data.get("status"),
            payload=event_data.get("payload") or {},
        )
        event = event_model.model_dump() if hasattr(event_model, "model_dump") else event_model.dict()
        record.queue.put_nowait(event)

    def enqueue_from_worker(event_type: str, event_data: dict | None = None) -> None:
        loop.call_soon_threadsafe(enqueue_event, event_type, event_data)

    async def run_agent_worker() -> None:
        enqueue_event(
            "workflow_started",
            {
                "session_id": run_id,
                "node_id": "input",
                "label": "Input",
                "status": "running",
                "payload": {
                    "input": {
                        "user_text": request.message,
                        "message": request.message,
                        "image_filename": request.imageFilename,
                        "imageFilename": request.imageFilename,
                    },
                    "user_text": request.message,
                    "message": request.message,
                    "image_filename": request.imageFilename,
                    "imageFilename": request.imageFilename,
                    "geojsonFilename": request.geojsonFilename,
                },
            },
        )

        def run_multimodal_agent():
            output_dir = os.path.join(os.path.dirname(__file__), 'output')
            agent = MultiModalMapAgent(output_dir)
            return agent.run(
                user_text=request.message,
                image_path=image_path,
                session_id=run_id,
                emit_event=enqueue_from_worker,
            )

        try:
            result = await asyncio.to_thread(run_multimodal_agent)
            record.result = result
            if result.get("error"):
                record.error = result["error"]
                enqueue_event(
                    "workflow_error",
                    {
                        "session_id": result.get("session_id", run_id),
                        "status": "error",
                        "payload": {"error": result["error"], "result": result},
                    },
                )
            else:
                enqueue_event(
                    "workflow_completed",
                    {
                        "session_id": result.get("session_id", run_id),
                        "status": "completed",
                        "payload": result,
                    },
                )
        except Exception as exc:
            record.error = str(exc)
            enqueue_event(
                "workflow_error",
                {
                    "session_id": run_id,
                    "status": "error",
                    "payload": {"error": str(exc)},
                },
            )
        finally:
            record.done = True
            record.queue.put_nowait(None)

    asyncio.create_task(run_agent_worker())
    return {"run_id": run_id, "session_id": run_id}


@app.get("/api/multimodal/runs/{run_id}/events")
async def stream_multimodal_run_events(run_id: str):
    record = run_store.get(run_id)
    if not record:
        return JSONResponse(status_code=404, content={"error": "run 不存在"})

    async def event_generator():
        while True:
            event = await record.queue.get()
            if event is None:
                break
            yield f"event: {event['type']}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/api/multimodal/runs/{run_id}")
async def get_multimodal_run(run_id: str):
    record = run_store.get(run_id)
    if not record:
        return JSONResponse(status_code=404, content={"error": "run 不存在"})
    return {
        "run_id": record.run_id,
        "done": record.done,
        "result": record.result,
        "error": record.error,
    }


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
            "files": {
                "geojson": geojson_basename,
                "style": style_basename,
                "manifest": result.get("manifest_path"),
            },
            "geofilepath": geojson_basename,
            "specfilepath": style_basename,
            "manifest_path": result.get("manifest_path"),
            "runtime_ms": result.get("runtime_ms"),
            "node_timings_ms": result.get("node_timings_ms"),
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


@app.get("/api/multimodal/session/{session_id}/icon/{filename}")
async def get_multimodal_session_icon(session_id: str, filename: str):
    """Serve generated POI icon images from a session icon directory."""
    base = _resolve_multimodal_session_dir(session_id)
    if not base:
        return JSONResponse(status_code=404, content={"error": "会话不存在"})

    safe_filename = os.path.basename(filename)
    icon_path = os.path.join(base, 'icon', safe_filename)
    if not os.path.exists(icon_path):
        return JSONResponse(status_code=404, content={"error": "图标不存在"})
    return FileResponse(
        icon_path,
        media_type="image/png",
        headers={"Cache-Control": "no-store, max-age=0"},
    )


@app.get("/api/multimodal/session/{session_id}")
async def get_multimodal_session(session_id: str):
    """获取指定会话的完整历史"""
    base = _resolve_multimodal_session_dir(session_id)
    if not base:
        return JSONResponse(status_code=404, content={"error": "会话不存在"})

    manifest_path = os.path.join(base, 'session_manifest.json')
    node3_path = os.path.join(base, 'node3')
    node4_path = os.path.join(base, 'node4')
    node2_path = os.path.join(base, 'node2')

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

    session_manifest = None
    if os.path.exists(manifest_path):
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                session_manifest = json.load(f)
        except Exception as e:
            print(f"⚠️ 读取 session_manifest 失败: {e}")

    intent = None
    try:
        intent = _load_latest_session_json(base, 'node1')
    except Exception as e:
        print(f"⚠️ 读取 node1 失败: {e}")

    visual_structure = None
    try:
        visual_structure = _load_latest_session_json(base, 'node2')
    except Exception as e:
        print(f"⚠️ 读取 node2 失败: {e}")

    style_code = None
    try:
        style_code = _load_latest_session_json(base, 'node4')
    except Exception as e:
        print(f"⚠️ 读取 node4 失败: {e}")

    # 处理 GeoJSON 数据：转换坐标并根据 style_code 判断是否获取步行路线
    origin_processed = None
    if origin_files:
        origin_processed = process_geojson_for_frontend(origin_files[-1]['data'], style_code)

    layout_processed = None
    if layout_files:
        layout_processed = process_geojson_for_frontend(layout_files[-1]['data'], style_code)

    groundtruth_processed = None
    if groundtruth_files:
        groundtruth_processed = process_geojson_for_frontend(groundtruth_files[-1]['data'], style_code)

    return {
        "session_id": session_id,
        "session_manifest": session_manifest,
        "intent": intent,
        "validation": session_manifest.get("workflow") if isinstance(session_manifest, dict) else None,
        "style_code": style_code,
        "visual_structure": visual_structure,
        "origin_file": {"filename": origin_files[-1]['filename'], "data": origin_processed} if origin_files else None,
        "has_origin": len(origin_files) > 0,
        "layout_file": {"filename": layout_files[-1]['filename'], "data": layout_processed} if layout_files else ({"filename": origin_files[-1]['filename'], "data": origin_processed} if origin_files else None),
        "has_layout": len(layout_files) > 0,
        "groundtruth_file": {"filename": groundtruth_files[-1]['filename'], "data": groundtruth_processed} if groundtruth_files else ({"filename": layout_files[-1]['filename'], "data": layout_processed} if layout_files else ({"filename": origin_files[-1]['filename'], "data": origin_processed} if origin_files else None)),
        "has_groundtruth": len(groundtruth_files) > 0,
    }


@app.post("/api/multimodal/session/{session_id}/rerun-downstream")
async def rerun_multimodal_downstream(session_id: str, request: RerunDownstreamRequest):
    """Rerun downstream nodes from an edited agent artifact payload."""
    base = _resolve_multimodal_session_dir(session_id)
    if not base:
        return JSONResponse(status_code=404, content={"error": "会话不存在"})

    try:
        manifest = None
        manifest_path = os.path.join(base, "session_manifest.json")
        if os.path.exists(manifest_path):
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)

        intent_artifact = _load_latest_session_json(base, "node1") or {}
        visual_structure = _load_latest_session_json(base, "node2")
        geojson_data = _load_latest_session_json(base, "node3")
        style_code = _load_latest_session_json(base, "node4")
        payload = request.payload or {}
        node_id = request.node_id
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        events = []

        def append_event(event_type: str, event_node_id: str, label: str, status: str, event_payload: dict | None = None):
            events.append({
                "type": event_type,
                "run_id": session_id,
                "session_id": session_id,
                "node_id": event_node_id,
                "label": label,
                "status": status,
                "payload": event_payload or {},
                "timestamp": datetime.now().isoformat(),
            })

        def feature_count(data):
            return len(data.get("features", [])) if isinstance(data, dict) else 0

        def has_hard_error():
            return bool(state.error and "验证节点" not in state.error)

        def save_artifact(content, filename: str, subdir: str, event_node_id: str, label: str, extra: dict | None = None):
            path = agent.session_manager.save_file(content, filename, subdir)
            event_payload = {"path": path, "subdir": subdir}
            if extra:
                event_payload.update(extra)
            append_event("artifact_saved", event_node_id, label, "completed", event_payload)
            return path

        user_text = (manifest or {}).get("input", {}).get("user_text") or ""
        intent_enriched = intent_artifact.get("intent_enriched") or user_text
        global_title = intent_artifact.get("global_title") or (manifest or {}).get("global_title")
        global_description = intent_artifact.get("global_description") or (manifest or {}).get("global_description")

        if node_id == "intent":
            next_intent = payload.get("intent_enriched") or payload.get("intent") or payload.get("user_text")
            if next_intent is None and isinstance(payload, dict):
                next_intent = payload
            if isinstance(next_intent, dict):
                intent_enriched = next_intent.get("intent_enriched") or next_intent.get("intent") or json.dumps(next_intent, ensure_ascii=False)
                global_title = next_intent.get("global_title", global_title)
                global_description = next_intent.get("global_description", global_description)
            else:
                intent_enriched = str(next_intent or intent_enriched)
            intent_artifact = {
                "intent_enriched": intent_enriched,
                "global_title": global_title,
                "global_description": global_description,
            }
        if node_id == "visual":
            visual_structure = payload.get("visual_structure") or payload
        elif node_id == "geojson":
            geojson_data = payload.get("geojson") or payload
        elif node_id in {"style", "icon_generation"}:
            style_code = payload.get("style_code") or payload
        elif node_id == "workflow_completed":
            if payload.get("intent_enriched"):
                intent_enriched = payload.get("intent_enriched")
                intent_artifact = {
                    "intent_enriched": intent_enriched,
                    "global_title": payload.get("global_title", global_title),
                    "global_description": payload.get("global_description", global_description),
                }
            visual_structure = payload.get("visual_structure") or visual_structure
            geojson_data = payload.get("geojson") or geojson_data
            style_code = payload.get("style_code") or style_code

        if not visual_structure:
            return JSONResponse(status_code=400, content={"error": "缺少 visual_structure"})
        if not geojson_data and node_id not in {"intent"}:
            return JSONResponse(status_code=400, content={"error": "缺少 geojson"})
        if not style_code and node_id in {"style", "icon_generation"}:
            return JSONResponse(status_code=400, content={"error": "缺少 style_code"})

        output_dir = os.path.join(os.path.dirname(__file__), 'output')
        agent = MultiModalMapAgent(output_dir)
        agent.session_manager.current_session_dir = base

        user_text = (manifest or {}).get("input", {}).get("user_text") or ""
        state = AgentState(
            session_id=session_id,
            user_text=user_text,
            image_path=(manifest or {}).get("input", {}).get("image_path"),
            intent_enriched=intent_enriched,
            global_title=global_title,
            global_description=global_description,
            visual_structure=visual_structure,
            geojson_data=geojson_data,
            style_code=style_code,
            is_valid=True,
        )

        def run_geojson_and_validation():
            nonlocal state, geojson_data
            for attempt in range(3):
                append_event(
                    "node_started",
                    "geojson",
                    "GeoJSON generation",
                    "running",
                    {"validation_retry_count": state.validation_retry_count},
                )
                state = agent.geojson_node.execute(state)
                if state.error:
                    return
                geojson_data = state.geojson_data
                append_event(
                    "node_completed",
                    "geojson",
                    "GeoJSON generation",
                    "completed",
                    {
                        "feature_count": feature_count(state.geojson_data),
                        "validation_retry_count": state.validation_retry_count,
                        "geojson": state.geojson_data,
                    },
                )
                save_artifact(
                    state.geojson_data,
                    f"geojson_rerun_{timestamp}_{attempt}.json",
                    "node3",
                    "geojson",
                    "GeoJSON artifact saved",
                    {"feature_count": feature_count(state.geojson_data)},
                )
                run_validation()
                if has_hard_error() or state.is_valid or state.failed_node != "node3":
                    break
                append_event(
                    "node_retry",
                    "geojson",
                    "GeoJSON retry requested",
                    "retrying",
                    {
                        "is_valid": state.is_valid,
                        "failed_node": state.failed_node,
                        "validation_feedback": state.validation_feedback,
                        "validation_retry_count": state.validation_retry_count,
                    },
                )
        def run_validation():
            nonlocal state
            state.failed_node = "none"
            append_event("node_started", "validation", "Validation", "running")
            state = agent.validation_node.execute(state)
            append_event(
                "node_validation",
                "validation",
                "Validation",
                "passed" if state.is_valid else "failed",
                {
                    "is_valid": state.is_valid,
                    "failed_node": state.failed_node,
                    "validation_feedback": state.validation_feedback,
                    "validation_retry_count": state.validation_retry_count,
                },
            )

        if node_id == "intent":
            save_artifact(intent_artifact, f"intent_rerun_{timestamp}.json", "node1", "intent", "Intent artifact saved")
            run_geojson_and_validation()
            if has_hard_error():
                return JSONResponse(status_code=500, content={"error": state.error, "events": events})
        elif node_id == "visual":
            save_artifact(visual_structure, f"visual_rerun_{timestamp}.json", "node2", "visual", "Visual artifact saved")
        elif node_id == "geojson":
            save_artifact(
                geojson_data,
                f"geojson_rerun_{timestamp}.json",
                "node3",
                "geojson",
                "GeoJSON artifact saved",
                {"feature_count": feature_count(geojson_data)},
            )
            run_validation()
            if has_hard_error():
                return JSONResponse(status_code=500, content={"error": state.error, "events": events})
        elif node_id == "workflow_completed":
            if payload.get("visual_structure"):
                save_artifact(visual_structure, f"visual_rerun_{timestamp}.json", "node2", "visual", "Visual artifact saved")
            if payload.get("geojson"):
                save_artifact(
                    geojson_data,
                    f"geojson_rerun_{timestamp}.json",
                    "node3",
                    "geojson",
                    "GeoJSON artifact saved",
                    {"feature_count": feature_count(geojson_data)},
                )
                run_validation()
                if has_hard_error():
                    return JSONResponse(status_code=500, content={"error": state.error, "events": events})

        if node_id in {"intent", "visual", "geojson", "workflow_completed"}:
            append_event("node_started", "style", "Style generation", "running")
            state = agent.style_node.execute(state)
            if has_hard_error():
                return JSONResponse(status_code=500, content={"error": state.error, "events": events})
            style_code = state.style_code
        elif node_id in {"style", "icon_generation"}:
            append_event("node_started", "style", "Style generation", "running")

        state = agent.icon_node.execute(state, base)
        if has_hard_error():
            return JSONResponse(status_code=500, content={"error": state.error, "events": events})
        style_code = state.style_code
        icon_meta = state.style_code.get("_icon_generation", {}) if isinstance(state.style_code, dict) else {}
        style_sections = sorted([k for k in state.style_code.keys() if not k.startswith("_")]) if isinstance(state.style_code, dict) else []
        append_event(
            "node_completed",
            "style",
            "Style generation",
            "completed",
            {"style_sections": style_sections, "style_code": state.style_code, "icon_generation": icon_meta},
        )

        style_path = save_artifact(
            state.style_code,
            f"style_{session_id}.json",
            "node4",
            "style",
            "Style artifact saved",
            {"style_sections": sorted([k for k in state.style_code.keys() if not k.startswith("_")]) if isinstance(state.style_code, dict) else [], "icon_generation": icon_meta},
        )

        return {
            "success": True,
            "session_id": session_id,
            "visual_structure": state.visual_structure,
            "geojson": state.geojson_data,
            "style_code": state.style_code,
            "style_path": style_path,
            "events": events,
        }
    except Exception as e:
        print(f"❌ downstream rerun 失败: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/api/multimodal/session/{session_id}/optimize-label-layout")
async def optimize_label_layout(session_id: str, request: LabelOptimizationRequest):
    """Manual label-layout optimization scaffold.

    The endpoint persists the current layout/screenshot context and returns a
    best-effort pass-through candidate. The response shape is intentionally
    compatible with a future VLM placement + validation loop.
    """
    base = _resolve_multimodal_session_dir(session_id)
    if not base:
        return JSONResponse(status_code=404, content={"error": "会话不存在"})

    try:
        layout = request.layout or {}
        outputs = layout.get("outputs") if isinstance(layout, dict) else []
        if not isinstance(outputs, list):
            outputs = []
        final_positions = [
            {
                "id": item.get("id"),
                "anchorLngLat": item.get("anchorLngLat"),
                "centerLngLat": item.get("centerLngLat"),
            }
            for item in outputs
            if isinstance(item, dict) and item.get("id")
        ]
        issues = []
        if not final_positions:
            issues.append("No label outputs were provided; returning an empty best-effort layout.")
        screenshot_size = len(request.screenshot or "")
        result = {
            "success": True,
            "session_id": session_id,
            "mode": "manual_scaffold",
            "rounds": [
                {
                    "round": 1,
                    "placement_agent": "pass_through",
                    "validation_agent": "structure_check",
                    "candidate_count": len(final_positions),
                    "issues": issues,
                }
            ],
            "final_positions": final_positions,
            "validation": {
                "passed": len(issues) == 0,
                "issues": issues,
                "suggested_adjustments": [],
            },
            "artifacts": {
                "screenshot_chars": screenshot_size,
                "viewport": request.viewport,
            },
        }

        target_dir = os.path.join(base, "label_optimization")
        os.makedirs(target_dir, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        artifact = {
            **result,
            "input": {
                "viewport": request.viewport,
                "geojson_feature_count": len((request.geojson or {}).get("features", [])) if isinstance(request.geojson, dict) else 0,
                "style_sections": sorted([key for key in (request.style_code or {}).keys() if not key.startswith("_")]) if isinstance(request.style_code, dict) else [],
                "layout": layout,
                "screenshot_chars": screenshot_size,
            },
        }
        artifact_path = os.path.join(target_dir, f"label_optimization_{timestamp}.json")
        with open(artifact_path, "w", encoding="utf-8") as f:
            json.dump(artifact, f, ensure_ascii=False, indent=2)
        result["artifact_path"] = os.path.relpath(artifact_path, base)
        return result
    except Exception as e:
        print(f"❌ label optimization failed: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})


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
    base = _resolve_multimodal_session_dir(session_id)
    if not base:
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
    base = _resolve_multimodal_session_dir(session_id)
    if not base:
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
