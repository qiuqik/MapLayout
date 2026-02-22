from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
import os
import json

from fastapi import UploadFile, File, Body
from datetime import datetime
import src.travel_agent as travel_agent
import src.vlm_agent as vlm_agent

app = FastAPI()

origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],  # 允许所有请求方法
    allow_headers=["*"],  # 允许所有请求头
)

# 定义接收消息的模型
class ChatMessage(BaseModel):
    message: str
    imageFilename: str

@app.post('/api/agent')
async def analyze(message: ChatMessage):
    # 处理输入文本
    user_input = message.message

    print(f"收到用户消息: {message.message}")
    try:
        agent = travel_agent.TravelPlannerAgent()
        json_output = agent.run(user_input)
        geo_file_path = agent.save_file(json_output)
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

    # 处理输入参考图
    image_name = message.imageFilename
    image_path = os.path.join(os.path.dirname(__file__), 'images', image_name)
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"图片文件不存在：{image_path}")
    try:
        agent = vlm_agent.VLMAgent(os.path.join(os.path.dirname(__file__), 'output/stylejson'))
        json_content = agent.analyze_image(image_path)
        style_file_path = agent.save_result(json_content)
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

    return {
        # "geofilepath": 'geojson_20260212_000412.json',
        "geofilepath": geo_file_path,
        "stylefilepath": style_file_path,
        # "stylefilepath": 'mapbox_style_20260222_182936.json'
    }



# 模拟返回 json
# @app.post("/api/agentmoni")
# async def chat(message: ChatMessage):
#     user_input = message.message;
#     print(f"收到用户消息: {message.message}")
#     filepath = os.path.join(os.path.dirname(__file__), 'output/geojson_20260212_000412.json')
#     with open(filepath, 'r', encoding='utf-8') as fh:
#             json_output = json.load(fh)
#     return {
#         "filepath": 'geojson_20260212_000412.json'
#         }


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

    # geojson
    if 'geojson' in name and os.path.isfile(geojson_path):
        try:
            with open(geojson_path, 'r', encoding='utf-8') as fh:
                data = json.load(fh)
            return data
        except Exception:
            return JSONResponse(status_code=500, content={"error": "cannot read file"})
    
    # stylejson
    if 'mapbox' in name and os.path.isfile(stylejson_path):
        try:
            with open(stylejson_path, 'r', encoding='utf-8') as fh:
                data = json.load(fh)
            return data
        except Exception:
            return JSONResponse(status_code=500, content={"error": "cannot read file"})

    # image
    if 'image' in name and os.path.isfile(image_path):
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




if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)