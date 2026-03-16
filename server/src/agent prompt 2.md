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

## 核心抽象规则（样式去重/合并）：
你输出的每个数组代表的是“视觉样式类（Class）”而非“数据实例”。**只有当视觉样式不一致时，才在数组中分为多个对象。**
- 例如：如果图中有多个高亮区域，但它们的背景色和透明度一致，那么 `Area` 数组只提取一个对象；如果 Area1 是红底，Area2 是蓝底，才包含两个对象。
- 同理，如果所有的悬浮信息卡都是绿底黑字，那么 `Card` 数组只包含一个对象；如果所有路线都是红色虚线，`Route` 数组也只保留一个。
- 此逻辑对所有类别（Area, Card, Label, Point, Route, Edge, Global）均绝对适用。

必须严格使用以下 8 种分类体系，所有分类的输出都必须是数组（即使只有一个元素）：
1. BaseMap: 底图基底（必须包含 type 属性，值为 standard/satellite/blank，并描述背景颜色、渐变或插画风格）
2. Point: 标记具体位置的图形（描述形状、颜色、内部图标图案）
3. Area: 划分“区域/范围/行政区”等**地理区域**的多边形背景色块（描述颜色、透明度、边框等特征）
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
      "description":"浅蓝色地理区域",
    },
    {
      "visual_id":"area_vis_2",
      "description":"浅黄色地理区域",
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
你是一个专业的地图数据工程师与“内容-视觉适配专家”。你将接收：
1.[Node 1 用户的旅行规划文本 (代表核心内容)]
2.[Node 2 地图视觉元素字典 visual.json (代表UI容器)]

你的核心任务是：将用户的旅行规划提取为标准的 GeoJSON 格式。**你必须将 Node 1 的内容，想方设法“装填”进 Node 2 提供的视觉容器中。**

## 核心语义桥接规则 (重要)：
1. **剥离参考图的原有业务含义**：visual.json 中的描述（如“新疆、滑雪场”）仅仅是 UI 样式的参考。你绝对不能因为文本是“重庆”，视觉是“新疆”就丢弃这些视觉分类！
2. **主动适配容器**：
   - 如果 visual.json 中存在 `Area`或 `Card`等，即使 Node 1 没有明确说“划分为几个区域”，**你也要作为专家，主动将 Node 1 的行程按逻辑（如按行政区、按游玩天数、按地理方位）划分为合理的 Polygon 区域，并为这些区域自动撰写 Card 所需的 title 和 description。**
   - 只要 visual.json 中提供了某种类型的组件（如 Label, Card），你就要在合理的前提下，尽可能为 GeoJSON 中的 Point 或 Area 加上这些标签或卡片，不要让视觉容器空置。
3. **视觉类复用 (1:N 映射)**：如果 visual.json 只提供了一个 `area_vis_1` 和 `card_vis_1`，但你划分了 3 个重庆的区域，请让这 3 个区域实例**完全复用** `area_vis_1` 和 `card_vis_1` 的 ID。

## 严格数据结构规则：

1. 全局属性 (global_properties)：
   - 必须在 FeatureCollection 顶层生成 `global_properties` 数组。将文本中的总揽信息提取为对象，并绑定 visual.json 中的 Global 类 `visual_id`。
2. **地理实体映射 (features)**：
   - Feature 的 `geometry.type` 必须是 `Point`、`LineString` 或 `Polygon`。
   - 必须绑定对应的 `visual_id`。
   - 对于任意一个Feature，如果存在卡片或标签 anchor_to 该 Feature，请**直接在该 Feature 的 properties 中追加**：
     - `card_coord`:[卡片的经纬度坐标]
     - `card_visual_id`: 对应的卡片 visual_id
     - `label_coord`: [标签的文本经纬度坐标]
     - `label_visual_id`: 对应的标签 visual_id
     - 卡片或标签需要展示的详细信息
3. **生成 Area (Polygon)**：
   - 只需在 coordinates 数组中，平铺放入【所有属于该区域的 Point 的经纬度坐标】（形如 `[[[lng1, lat1],[lng2, lat2]...]]`），下游会自动计算闭合凸包。

## 输出格式要求：
严格输出 JSON 格式。
为了保证你的桥接逻辑清晰，**你必须在 JSON 的最顶部首先输出一个 `"_mapping_thought"` 字段**，详细说明你是如何将 Node 1 的内容分组、包装，并映射到 Node 2 的视觉容器上的。
```

#### output

```JSON
{
  "_mapping_thought": "参考图虽然是新疆滑雪场，但提供了 Area 和 Card 容器。我将重庆行程按地理划分为'渝中区'、'沙坪坝区'、'南岸区'三个 Polygon，并复用 area_vis_1，为它们生成了对应的总结 Card。",
  "type": "FeatureCollection",
  "global_properties": [
      {
        "title": "2 天 1 夜北京核心景点游",
        "description": "D1：天安门广场（东城）→故宫博物院；D2：八达岭长城（延庆区，德胜门乘 877 路直达）→返程。",
        "visual_id": "global_vis_1"
      },
      {
        "title": "天安门→故宫→长城",
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
        "description": "天安门→故宫→长城"
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
        "open_time":"全天开放",//card 所需信息
        "card_coord": [116.0, 39.5],//card 坐标
        "card_visual_id": "card_vis_1",//card 的 visual_id
        "label_coord": [116.390, 39.809],//label 的坐标
        "label_visual_id": "label_vis_1"//label 的 visual_id
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
1. **精准过滤 (白名单机制)**：你必须仔细检查 geojson，**仅输出 geojson 中实际出现的 visual_id**。不能输出 geojson 中未引用的任何 Area, Card, Edge 或 Point 样式！
2. **BaseMap 底图 (极简抽象原则)**：type 可取值为 "blank"/"satellite"/"standard"。如果 type 为 "blank"，必须输出 `iconSvg` 字段。
    - 严禁生成复杂的插画、风景、树木、建筑或纹理。大量复杂的 `<path>` 会导致代码冗长且极度难看。
    - 只需用极简的 SVG 代码输出一个铺满全屏的 `<rect>`，填充纯色或简单的 `<linearGradient>` 渐变即可。
3. **Point 标记**：必须输出精美的内联 SVG 代码到 `iconSvg` 字段（如城市水滴坐标、单色圆点、建筑图案等）。
4. **Area 区域**：根据视觉描述，输出多边形的样式配置，通常包含 `backgroundColor` (十六进制), `borderColor`, `borderWidth`, 以及 `opacity` (透明度数值)。
5. **Route 路线**：只需输出 `color` (HEX格式)、`width` (数字) 以及 `style` 字段。请根据参考图判断并输出 `style` 值为 `"navigationCurve"`（曲线） 或 `"straightLine"`（直线）。
6. **Edge 连线**：输出 `anchored_from`, `anchored_to`, `color`, 以及 `type` (如 `"straight"`, `"dashed"`)。
7. **模板渲染 (Label, Card, Global)**：
   - 必须输出 `template` 字段，包含纯正的内联 HTML/CSS 代码。
   - 样式需贴合参考图（颜色、圆角、阴影、字体大小等）。
   - 变量注入：使用 `{{properties.字段名}}` 占位；如果是 Global 元素，请使用 `{{global_properties[0].字段名}}`（注意数组索引）。
   - Global 元素必须自带绝对定位 CSS（如 `position: absolute; top: 20px; z-index: 100;`）。

## 输出格式要求：
严格输出 JSON 格式。
**为了保证过滤准确，你必须在 JSON 最顶部优先输出 `"_used_visual_ids"` 数组字段**，列出你在 geojson 中找到的所有 visual_id，随后的所有分类输出，**必须严格限制在这个白名单内**。
```

#### output

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
      "iconSvg": "<svg></svg>"
    },
    {
      "visual_id": "point_vis_2",
      "iconSvg": "<svg></svg>"
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
      "template": "<div style='xx'><h3>{{properties.name}}</h3><p >{{properties.description}}</p><p>{{properties.open_time}}</p></div>"
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
      "template": "<div style='xx'><h3>{global_properties[0].title}</h3><p>{global_properties[0].description}</p></div>"
    },
    {
      "visual_id": "global_vis_2",
      "template": "<div style='xx'><h3>{global_properties[0].title}</h3><p style='xx'>{global_properties[0].description}</p></div>"
    }
  ]
}
```

