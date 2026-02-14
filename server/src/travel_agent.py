import os
import json
from typing import List, Optional, Literal, Union, Dict, Any
from pydantic import BaseModel, Field
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from dotenv import load_dotenv
from datetime import datetime

class ChartSeriesItem(BaseModel):
    title: Optional[str] = Field(None, description="柱状图/折线图数据名称")
    name: Optional[str] = Field(None, description="饼图数据名称")
    value: Optional[float] = Field(None, description="饼图数据项数值")
    data: Optional[List[float]] = Field(None, description="柱状图/折线图数值数组")

class ChartData(BaseModel):
    type: str = Field(..., description="图表类型，如 bar, line, pie")
    title: str = Field(..., description="图表标题")
    xAxis: Optional[List[str]] = Field(None, description="X轴标签")
    series: List[ChartSeriesItem] = Field(..., description="图表数据系列")

class Geometry(BaseModel):
    type: Literal["Point", "LineString"]
    coordinates: Union[List[float], List[List[float]]] = Field(..., description="[经度, 纬度] 或 [[经度, 纬度], ...]")

class Properties(BaseModel):
    type: Literal["point", "line"]
    title: str
    index: Optional[int] = None
    width: Optional[int] = None
    category: Optional[str] = None
    desc: Optional[str] = None
    address: Optional[str] = None
    openTime: Optional[str] = None
    ticketPrice: Optional[str] = None
    rating: Optional[float] = None
    tags: Optional[List[str]] = None
    chartData: Optional[ChartData] = None

class Feature(BaseModel):
    type: Literal["Feature"] = "Feature"
    properties: Properties
    geometry: Geometry

class GeoData(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: List[Feature]


# Agent Chain
class TravelPlannerAgent:
    def __init__(self):
        load_dotenv(".env")

        API_KEY = os.getenv("OPENAI_API_KEY") 
        http_proxy = os.getenv("HTTP_PROXY")
        llm_model = os.getenv("LLM_MODEL")

        if not API_KEY:
            raise ValueError("⚠️ .env 文件中未配置 API_KEY")
        if not llm_model:
            raise ValueError("⚠️ .env 文件中未配置 LLM_MODEL")
        if not http_proxy:
            raise ValueError("⚠️ .env 文件中未配置 HTTP_PROXY")
        
        self.llm = ChatOpenAI(
            api_key=API_KEY,
            model=llm_model,
            base_url=http_proxy,
            temperature=0.7
        )
        
        self.structured_llm = self.llm.with_structured_output(GeoData)
        
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", """
            你是一个专业的旅游规划助手。
            请根据用户的需求，规划一条合理的旅游路线。
            
            要求：
            1. 必须生成一个 GeoData JSON 对象。
            2. Features 列表中必须包含：
               - 一个类型为 'line' 的 Feature，表示路线轨迹 (LineString)。
               - 若干个类型为 'point' 的 Feature，表示具体景点 (Point)。
            3. 'point' 必须包含详细信息：ticketPrice, openTime, rating, tags, chartData 等。
            4. 经纬度 (coordinates) 必须是该地点真实的或近似的坐标(GCJ-02 国测局坐标)。
            5. 'chartData' 请根据景点特性生成合理的数据。如果是饼图，series 列表中使用 name 和 value；如果是柱状图/折线图，series 列表中使用 title 和 data。
            """),
            ("human", "{input}")
        ])
        
        self.chain = self.prompt | self.structured_llm

    def run(self, user_query: str) -> str:
        """
        执行规划并返回 JSON 字符串
        """
        print(f"正在规划行程: {user_query} ...")
        try:
            result: GeoData = self.chain.invoke({"input": user_query})
            return result.model_dump_json(indent=4)
        except Exception as e:
            return json.dumps({"error": str(e)}, indent=4)

    def save_file(self, geojson: str) -> str:
        """
        保存文件
        """
        output_dir = "output/geojson"
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"geojson_{timestamp}.json"
        filepath = os.path.join(output_dir, filename)
        # 保存
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(geojson)
            print(f"\n已保存为{filepath}")
        return filename
    
# 帮我规划成都 3 日游，预算 1500 元，想以吃美食和逛小众景点为主
# 规划西安 2 日游，预算 1000 元，主要想去历史古迹，不想走太多路
# 做一份青岛 3 日游攻略，预算 2000 元，主打海滨风光和海鲜美食
# 帮我安排杭州 1 日游，预算 200 元，想逛西湖周边还能打卡网红茶饮店
# 规划厦门 3 日游，预算 1800 元，主打鼓浪屿和海边散步，偏爱安静的地方
# 做一份重庆 2 日游路线，预算 1200 元，想打卡洪崖洞还能吃地道火锅
# 帮我设计苏州 3 日游，预算 2000 元，主要逛园林和江南水乡，适合拍照
# 规划北京 4 日游，预算 3000 元，想走经典景点，带老人孩子不累的路线
# 做一份丽江 2 日游攻略，预算 1600 元，主打古城闲逛和雪山脚下打卡
# 帮我安排桂林 3 日游，预算 2200 元，想坐船游漓江，看山水风光
# 规划长沙 2 日游，预算 1000 元，主要吃特色小吃，打卡网红景点
# 做一份昆明 3 日游路线，预算 1800 元，想逛滇池和翠湖，适合慢节奏游玩
# 帮我规划南京 3 日游，预算 2000 元，主打历史景点，顺便吃当地特色小吃
# 规划三亚 3 日游，预算 3500 元，想住海边附近，主打沙滩和海鲜
# 做一份武汉 2 日游攻略，预算 1200 元，想逛黄鹤楼和户部巷，吃湖北菜