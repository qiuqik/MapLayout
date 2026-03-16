User input:

```JSON
【参考图】
【我想在周末去北京旅游，主要想去故宫、天安门和长城，希望能有一个详细的路线规划。预算 2000 元。】
```

### Node1

#### Prompt

```Markdown
你是一个专业的旅游规划顾问和意图分析专家。你的任务是分析用户的旅游需求，进行意图丰富 (Intent Enrichment)。

## 分析要求：
1. **任务目标识别**：识别用户想要做什么（如旅游路线规划、区域范围游览、地点推荐等），并严格遵守用户的预算限制。
2. **缺失信息推测**：主动推测合理的目的地、天数、出行方式。
3. **行程生成与精简输出**：用极度精简、干练的文字描述行程。必须明确包含具体的 POI（兴趣点）名称、所属行政区/游玩范围（区域）、以及关键的交通指引（如直达公交/地铁等）。

## 输出格式要求：
请直接输出一段紧凑的纯文本，不要使用 Markdown 复杂排版（不需要加粗或多级列表）。
格式参考：
"[总述：如 2天1夜XX游，预算XXX元]。D1：地点A（所属区）→地点B→地点C；D2：地点D（所属区，交通方式）→返程。 [简短的总结说明]。"
请直接给出结果，不需要任何多余的解释。
```

#### output

```JSON
2天1夜北京核心景点游，预算2000元。D1：天安门广场（东城）→故宫博物院→景山公园→王府井步行街；D2：八达岭长城（延庆区，德胜门乘877路直达）→返程。
```

### Node2

#### Prompt

```Markdown
你是一个专业的地图数据可视化架构师。你的任务是分析用户上传的旅游路线参考图，将其拆解为高度抽象的前端渲染组件集。
请不要关注具体的文字内容，而是关注“有什么类型的视觉元素”以及“元素之间的关联”。

必须严格使用以下 8 种分类体系，所有分类的输出都必须是数组（即使只有一个元素）：
1. BaseMap: 底图基底（必须包含 type 属性，值为 standard/satellite/blank，并描述背景颜色、渐变或插画风格）
2. Point: 标记具体位置的图形（描述形状、颜色、内部图标图案）
3. Area: 划分区域的多边形背景色块（描述颜色、透明度、边框等特征）
4. Route: 实际的导航主线或支线（描述颜色和连接逻辑）
5. Label: 依附于其他元素的文本标签
6. Card: 包含详细信息的悬浮卡片背景（描述颜色和内容排版）
7. Edge: 纯视觉牵引线（如从卡片指向地标或区域的连线、箭头）
8. Global: 非地图地理实质元素的全局装饰（如顶部大标题、角落总结条幅等）

**输出要求：**
1. 严格输出 JSON 格式，不要多余的话。
2. 确保每个元素都有唯一且语义化的 `visual_id`（如 basemap_illustration, area_vis_1, point_vis_1）。
3. 使用 `description` 详细描述元素的颜色、形状和视觉特征。
4. 分析依附关系：使用 `anchored_from`（起点）和 `anchored_to`（终点/目标对象，如指向 Point 或 Area）。注意，`anchored_to` 可以是字符串或字符串数组。
5. **如果某类元素在图中没有出现，则省略该数组。**

**JSON 模板示例：**
{
  "BaseMap":[{ "visual_id": "basemap_1", "type": "blank", "description": "渐变色背景图" }],
  "Point":[{ "visual_id": "point_vis_1", "description": "带边框的黄色圆形图标" }],
  "Area":[{ "visual_id": "area_vis_1", "description": "带有浅蓝色半透明背景的区域色块" }],
  "Route":[{ "visual_id": "route_vis_1", "description": "黑色的主环线" }],
  "Label":[{ "visual_id": "label_vis_1", "description": "黑色文本标签", "anchored_to": ["point_vis_1", "area_vis_1"] }],
  "Card":[{ "visual_id": "card_vis_1", "description": "包含标题和时间信息的卡片", "anchored_to": "point_vis_1" }],
  "Edge":[{ "visual_id": "edge_vis_1", "description": "红色箭头连线", "anchored_from": "card_vis_1", "anchored_to": "point_vis_1" }],
  "Global":[{ "visual_id": "global_vis_1", "description": "顶部大标题" }]
}
```

#### output

```JSON
{
  "BaseMap": [
    {
      "visual_id": "basemap_illustration",
      "type": "blank",
      "description": "手绘插画风格底图，包含渐变色背景（天空蓝到沙漠黄）以及底部的湖泊与胡杨林景观插画"
    }
  ],
  "Point": [
    {
      "visual_id": "point_vis_1",
      "description": "POI的圆形地标图标（内含建筑图案）"
    },
    {
      "visual_id": "point_vis_2",
      "description": "城市图标（标准水滴型地标）"
    },
  ],
  "Area":[
    {
      "visual_id":"area_vis_1",
      "description":"浅蓝色背景区域",
    },
    {
      "visual_id":"area_vis_2",
      "description":"浅黄色背景区域",
    }
  ],
  "Route": [
    {
      "visual_id": "route_vis_1",
      "description": "黑色的主环线，连接乌鲁木齐、库尔勒、阿克苏、塔县等地，形成闭环"
    },
    {
      "visual_id": "route_vis_2",
      "description": "红色的沙漠公路支线，连接阿拉尔与和田"
    }
  ],
  "Label": [
    {
      "visual_id": "label_vis_1",
      "description": "文本标签：乌鲁木齐",
      "anchored_to": ["point_vis_1", "point_vis_2"]
    }
  ],
  "Card": [
    {
      "visual_id": "card_vis_1",
      "description": "绿色背景卡片：包含 POI 名称和简要描述，以及开放时间",
      "anchored_to": "point_vis_1"
    }
  ],
  "Edge": [
    {
      "visual_id": "edge_vis_1",
      "description": "红色箭头，从卡片指向POI位置",
      "anchored_from": "card_vis_1",
      "anchored_to": "point_vis_1"
    }
  ],
  "Global": [
    {
      "visual_id": "global_vis_1",
      "description": "顶部黑色大字标题：秋季南疆环线攻略，行程主题"
    },
    {
      "visual_id": "global_vis_2",
      "description": "左上角橙色背景条幅：乌进喀出，不走回头路，对行程的简单总结"
    }
  ]
}
```

### Node3

#### Prompt

```Markdown
你是一个专业的地图数据工程师。你将接收：
1.[用户的详实旅行规划文本]
2.[地图视觉元素字典 visual.json]

你的任务是：将用户的旅行规划提取为标准的 GeoJSON 格式，并将规划中的元素与 visual.json 中的视觉分类 `visual_id` 对应。

## 严格数据结构规则：

1. 全局属性 (global_properties)：
   - 必须在 FeatureCollection 顶层生成 `global_properties` 数组。将文本中的总揽信息提取为对象，并绑定 visual.json 中的 Global 类 `visual_id`。

2. **地理实体映射 (features)**：
   - `geometry.type` 必须严格是 `Point`、`LineString` 或 `Polygon`。
   - 必须绑定对应的 `visual_id`。

3. **生成 Area (Polygon)**：
   - 如果文本中存在游览“区域/范围/行政区”，请生成 Polygon Feature。
   - **不需要计算真实的闭合边界**：只需在 Polygon 的 coordinates 数组中，平铺放入【所有属于该区域的 Point 的经纬度坐标】（形如 `[[[lng1, lat1], [lng2, lat2], ...]]`），下游会自动计算最小凸包。

4. **属性扁平化组合 (针对 Point 和 Area)**：
   - **不要为 Card 或 Label 单独生成 Feature**。如果某个点（Point）或区域（Area）需要附带卡片或标签，请**直接在该 Feature 的 properties 中追加**：
     - `card_coord`:[卡片的经纬度坐标]
     - `card_visual_id`: 对应的卡片 visual_id
     - `label_coord`: [标签的文本经纬度坐标]
     - `label_visual_id`: 对应的标签 visual_id

5. **路线生成 (Route)**：
   - 将相关 POI 串联成 `LineString`。

**对于 visual.json 中没有的项，或该项在文本中无意义，就无需生成对应数据。** 严格输出合法的 JSON 格式。
```

#### output

```JSON
{
  "type": "FeatureCollection",
  "global_properties": [
      {
        "title": "2 天 1 夜北京核心景点游",
        "description": "D1：天安门广场（东城）→故宫博物院→景山公园→王府井步行街；D2：八达岭长城（延庆区，德胜门乘 877 路直达）→返程。行程沿中轴线向北延伸，交通便捷。预算涵盖交通/住宿/门票/餐饮，合理分配轻松出行。",
        "visual_id": "global_vis_1"
      },
      {
        "title": "天安门→故宫→景山→王府井→长城",
        "description": "简单总结",
        "visual_id": " global_vis_2"
      }
  ],
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [116.397, 39.908],
          [116.397, 39.916],
          [116.395, 39.923],
          [116.412, 39.913],
          [116.416, 40.359]
        ]
      },
      "properties": {
        "visual_id": "route_vis_1",
        "name": "北京核心景点路线",
        "description": "天安门→故宫→景山→长城"
      }
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [116.397, 39.908]
      },
      "properties": {
        "visual_id": "point_vis_1",
        "name": "天安门广场",
        "description": "东城，行程起点",
        "open_time":"全天开放",
        "card_coord": [116.0, 39.5],
        "card_visual_id": "card_vis_1",
        "label_coord": [116.390, 39.809],
        "label_visual_id": "label_vis_1"
      }
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [116.397, 39.916]
      },
      "properties": {
        "visual_id": "point_vis_1",
        "name": "故宫博物院",
        "description": "核心景点，需预约",
        "open_time":"9:00am-17:00pm",
        "card_coord": [116.1, 39.7],
        "card_visual_id": "card_vis_1",
        "label_coord": [116.390, 39.809],
        "label_visual_id": "label_vis_1"
      }
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [116.395, 39.923]
      },
      "properties": {
        "visual_id": "point_vis_1",
        "name": "景山公园",
        "description": "俯瞰故宫全景",
        "open_time":"8:00am-22:00pm",
        "card_coord": [116.0, 39.5],
        "card_visual_id": "card_vis_1",
        "label_coord": [116.390, 39.809],
        "label_visual_id": "label_vis_1"
      }
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [116.412, 39.913]
      },
      "properties": {
        "visual_id": "point_vis_1",
        "name": "王府井大街",
        "description": "东城区，D1 行程",
        "open_time":"8:00am-22:00pm",
        "card_coord": [116.0, 39.5],
        "card_visual_id": "card_vis_1",
        "label_coord": [116.390, 39.809],
        "label_visual_id": "label_vis_1"
      }
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [116.416, 40.359]
      },
      "properties": {
        "visual_id": "point_vis_1",
        "name": "八达岭长城",
        "description": "延庆区，D2 行程",
        "open_time":"8:00am-22:00pm",
        "card_coord": [116.0, 39.5],
        "card_visual_id": "card_vis_1",
        "label_coord": [116.390, 39.809],
        "label_visual_id": "label_vis_1"
      }
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [116.416,39.928]
      },
      "properties": {
        "visual_id": "point_vis_2",
        "name": "东城区",
        "label_coord": [116.390, 39.809],
        "label_visual_id": "label_vis_1"
      }
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [115.974,40.457]
      },
      "properties": {
        "visual_id": "point_vis_2",
        "name": "延庆区",
        "label_coord": [116.390, 39.809],
        "label_visual_id": "label_vis_1"
      }
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "Polygon",
        "coordinates": [[
            [116.390, 39.809],
            [116.416,39.928]
        ]]
      },
      "properties": {
        "visual_id": "area_vis_1",
        "name": "东城区",
      }
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "Polygon",
        "coordinates": [[
            [115.974,40.457],
            [115.974,40.457],
            [115.974,40.457]
        ]]
      },
      "properties": {
        "visual_id": "area_vis_2",
        "name": "延庆区",
      }
    },
  ]
}
```

### Node4

#### Prompt

```Markdown
你是一个资深的地图 UI 视觉还原工程师与前端组件专家。你将接收：
1.[旅游路线参考图]
2. [视觉元素拆解 visual.json]
3.[用户实际行程 geojson]

你的任务是：对 visual.json 进行重构输出，为前端提供直接可用的样式与渲染模板。

## 核心重构规则：
1. **精准过滤**：对于 visual.json 中没有提及的项无需输出；且只输出 geojson 中被实际引用（存在）的 visual_id 项。
2. **BaseMap 底图**：type 可取值为 "blank"/"satellite"/"standard"。如果 type 为 "blank"，**必须输出 `iconSvg` 字段**，用纯 SVG 代码（包含 `<svg>` 标签）绘制符合参考图描述的简单背景。
3. **Point 标记**：**必须输出 `iconSvg` 字段**。请根据 visual.json 的描述，编写精美的内联 SVG 代码（如城市水滴坐标、单色圆点、建筑图案等），确保支持透明背景与正确的 viewBox。
4. **Area 区域**：根据视觉描述，输出多边形的样式配置，通常包含 `backgroundColor` (十六进制), `borderColor`, `borderWidth`, 以及 `opacity` (透明度数值)。
5. **Route 路线**：只需输出 `color` (HEX格式)、`width` (数字) 以及 `style` 字段。请根据参考图判断并输出 `style` 值为 `"navigationCurve"`（曲线） 或 `"straightLine"`（直线）。
6. **Edge 连线**：输出 `anchored_from`, `anchored_to`, `color`, 以及 `type` (如 `"straight"`, `"dashed"`)。
7. **模板渲染 (Label, Card, Global)**：
   - 必须输出 `template` 字段，包含纯正的内联 HTML/CSS 代码。
   - 样式需贴合原图描述（颜色、圆角、阴影、字体大小等）。
   - 变量注入：使用 `{properties.字段名}` 占位；如果是 Global 元素，请使用 `{global_properties[0].字段名}`（注意数组索引）。
   - Global 元素必须自带绝对定位 CSS（如 `position: absolute; top: 20px; z-index: 100;`）。

## 输出格式要求：
严格输出 JSON 格式。最外层 Key 严格遵循视觉大类（BaseMap, Area, Point, Route, Label, Card, Edge, Global），内部为对象数组。
（请仔细检查你的 SVG 语法和 HTML 内联样式的闭合规范）
```

#### output

对 visual.json 进行重构输出，对于 visual.json 中没有提及的项，则无需输出。且只输出 geojson 中存在的 visual_id 项。若 BaseMap 的 type 为 blank，请输出 iconSvg 对背景进行简单展示。对于 Point，必须输出 iconSvg 项，即使只用单色圆点。对于 Route，只需输出 color、width、style 项。对于 Label、Card、Global 项，需要输出样式代码 template 直接嵌入网页代码。请注意样式要符合参考图，但数据来源为 geojson。

```JSON
{
  "BaseMap": [
    {
      "type": "blank",//卫星图为 satellite，标准地图为 standard，只有为 blank 时才输出 iconSvg 项
      "iconSvg": "<svg width=\"100%\" height=\"100%\" xmlns=\"http://www.w3.org/2000/svg\"><defs><linearGradient id=\"skyToDesert\" x1=\"0%\" y1=\"0%\" x2=\"100%\" y2=\"100%\"><stop offset=\"0%\" style=\"stop-color:#87CEEB;stop-opacity:1\" /><stop offset=\"100%\" style=\"stop-color:#EDC9AF;stop-opacity:1\" /></linearGradient></defs><rect width=\"100%\" height=\"100%\" fill=\"url(#skyToDesert)\" /></svg>"
    }
  ],
  "Point": [
    {
      "visual_id": "point_vis_1",
      "iconSvg": "<svg width='24' height='24' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'><path d='M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z' fill='#d32f2f'/></svg>"
    },
    {
      "visual_id": "point_vis_2",
      "iconSvg": "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z' fill='#fbbf24' stroke='#b45309' stroke-width='1.5'/><circle cx='12' cy='9' r='3.5' fill='white'/><path d='M12 6l-3 3v3h6V9l-3-3z' fill='#1e40af'/></svg>"
    },
  ],
  "Area":[
    {
      "visual_id":"area_vis_1",
      "backgroundColor":"#729384",
      "borderColor":"#122321",
      "borderWidth": 3,
      "opacity": 0.5
    },
    {
      "visual_id":"area_vis_2",
      "backgroundColor":"#344584",
      "borderColor":"#112542",
      "borderWidth": 3,
      "opacity": 0.5
    }
  ],
  "Route": [
    {
      "visual_id": "route_vis_1",
      "color": "#000000",
      "width": 4,    
      "style": "navigationCurve"/"straightLine" //需判断是曲线还是直线
    }
  ],
  "Label": [
    {
      "visual_id": "label_vis_1",
      "template": "<div style='background-color: #FFF; padding: 6px 10px; border-radius: 4px; font-size: 12px; color: #000; box-shadow: 0 1px 3px rgba(0,0,0,0.2);'>{properties.name}</div>"
    }
  ],
  "Card": [
    {
      "visual_id": "card_vis_1",
      "template": "<div style='background:#FFE0B2; border:1px solid #FFB74D; border-radius:8px; padding:10px; width:200px; box-shadow:0 4px 6px rgba(0,0,0,0.1);'><h3 style='margin:0 0 4px 0; font-size:14px; font-weight:bold; color:#E65100;'>{{properties.name}}</h3><p style='margin:0; font-size:12px; color:#555; line-height:1.4;'>{{properties.description}}</p><p style='margin:0; font-size:12px; color:#555; line-height:1.4;'>{{properties.open_time}}</p></div>"
    }
  ],
  "Edge": [
    {
      "visual_id": "edge_vis_1",
      "anchored_from": "card_vis_1",
      "anchored_to": "point_vis_1",
      "color": "#d32f2f",
      "type": "straight",
    }
  ],
  "Global": [
    {
      "visual_id": "global_vis_1",
      "template": "<div style='position: absolute; top: 20px; left: 20px; z-index: 100; font-size: 18px; font-weight: bold; color: #333; line-height: 1.4;'><h3>{global_properties[0].title}</h3><p style='font-size: 12px; color: #666;'>{global_properties[0].description}</p></div>"
    },
    {
      "visual_id": "global_vis_2",
      "template": "<div style='position: absolute; top: 20px; left: 20px; z-index: 100; font-size: 18px; font-weight: bold; color: #333; line-height: 1.4;'><h3>{global_properties[0].title}</h3><p style='font-size: 12px; color: #666;'>{global_properties[0].description}</p></div>"
    }
  ]
}
```