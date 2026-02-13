from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import os
import json

import src.travel_agent as Agent

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

# 对话接口
@app.post("/api/travelagent")
async def chat(message: ChatMessage):
    user_input = message.message;
    print(f"收到用户消息: {message.message}")
    agent = Agent.TravelPlannerAgent()
    json_output = agent.run(user_input)
    filepath = agent.save_file(json_output)
    return {
        "filepath": filepath
        }

# 模拟返回 json
@app.post("/api/travelagentmoni")
async def chat(message: ChatMessage):
    user_input = message.message;
    print(f"收到用户消息: {message.message}")
    # agent = Agent.TravelPlannerAgent()
    # json_output = agent.run(user_input)
    filepath = os.path.join(os.path.dirname(__file__), 'output/geojson_20260212_000412.json')
    with open(filepath, 'r', encoding='utf-8') as fh:
            json_output = json.load(fh)
    return {
        "filepath": 'geojson_20260212_000412.json'
        }

# 返回output/.json文件
@app.get("/files")
async def list_files():
    base = os.path.join(os.path.dirname(__file__), 'output')
    try:
        files = [f for f in os.listdir(base) if f.endswith('.json')]
    except Exception:
        files = []
    return {"files": files}


# 返回output目录文件
@app.get("/files/{name}")
async def get_file(name: str):
    # 简单校验，防止目录穿越
    if '/' in name or '..' in name:
        return JSONResponse(status_code=400, content={"error": "invalid filename"})
    path = os.path.join(os.path.dirname(__file__), 'output', name)
    if not os.path.isfile(path):
        return JSONResponse(status_code=404, content={"error": "not found"})
    try:
        with open(path, 'r', encoding='utf-8') as fh:
            data = json.load(fh)
    except Exception:
        return JSONResponse(status_code=500, content={"error": "cannot read file"})
    return data

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)