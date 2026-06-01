# MapLayout 项目理解与相关文献地图

更新日期：2026-05-26

近期文献增补检索：2026-05-26（重点覆盖 2024-2026 年正式发表条目）

## 1. 调研目的与范围

本文件基于项目说明文档与关键实现，整理可支撑 MapLayout 研究论证的相关文献。优先检索用户指定的高影响力目标圈：CHI、IEEE VIS / TVCG、SIGGRAPH / ACM TOG、CVPR 与 AAAI；对直接涉及标注配置但不在此目标圈的 PacificVis 文献，作为方法补充纳入。

这不是完成 PRISMA 计数与全文筛选的系统性回顾，而是一份面向投稿定位与实验设计的 scoped literature map。本轮纳入 29 篇条目，其中 25 篇为核心、近邻或直接制图补充文献，4 篇为 CVPR / AAAI / SIGGRAPH 跨领域背景。其问题焦点为：

> 如何以可追踪的结构化中间表示，将文字旅游意图与参考图片的视觉语言转化为可编辑的叙事地图，并以确定性布局、自动指标及人工修订评估其质量？

## 2. 由代码确认的系统内容

项目目前已实现一条“生成、布局、修订、评估”链路，而非仅生成单张地图图片：

| 系统部分 | 现有能力 | 研究含义 |
| --- | --- | --- |
| 后端生成管线 | LangGraph 节点将用户文字意图、参考图视觉类、GeoJSON 与 Mapbox 样式串接；含 validation retry 与 session manifest | 可研究结构化中间表示是否提升可追踪性与失败诊断能力 |
| 视觉结构表示 | 将图片抽取为 `BaseMap/Point/Area/Route/Label/Card/Edge/Global` 视觉类，并通过 `visual_id` 映射到数据与样式 | 有别于像素级 style transfer：本项目转移的是可编辑 UI/地图设计语汇 |
| 交互式地图与布局 | Mapbox 前端支持卡片/标签人工拖拽，以及 Force、SA、直接 Voronoi 与 `Force -> Voronoi -> refinement` 管线 | 可将 AI 建议视为共创起点，而不是自动产物终点 |
| 可重复评估 | 以 seed、pipeline 与 metadata 固定条件；指标含 Overlap、Utility、Balance、MeanIoU、Aesthetics、Stability、MeanTime | 支持算法比较、稳定性报告与人工结果对照 |

代码/文档依据：

- `docs/CHI_ROADMAP.md`
- `architecture.md`
- `server/src/multi_modal_agent.py`
- `server/src/nodes/visual_structure.py`
- `server/src/nodes/geojson_generation.py`
- `web/src/components/mapagent/TravelMap.tsx`
- `web/src/app/agent/weightedVoronoi/weightedVoronoiLayout.ts`
- `evaluate/index.py`

## 3. 适合的论文定位

### 3.1 建议主线

MapLayout 最适合被描述为：

> 一个面向叙事旅游地图的 human-AI co-authoring 系统：它从文字意图与视觉参考建立可审计的结构化表示，生成可编辑地图，并使用确定性布局与人类修订数据进行多层次评估。

这条主线最贴近 CHI；若强化可视化方法、基准与消融，也可朝 IEEE VIS / TVCG 组织。

### 3.2 可形成的研究问题

| 候选 RQ | 需要的证据 | 主要文献群 |
| --- | --- | --- |
| RQ1：结构化视觉类与映射链是否比直接生成更易于修订、追踪及调试？ | 中间表示消融、mapping coverage、失败类型、任务研究 | AI Chains、Luminate、Epigraphics、NL4DV |
| RQ2：确定性混合布局是否在保留语义锚点的同时降低卡片/标签遮挡？ | 多 session、多 seed、Force/SA/Voronoi 对照、Overlap/MeanIoU/Stability | Christensen、Been、Meng、Lin |
| RQ3：参考图导向的可编辑旅游地图是否提升设计效率或主观质量？ | 与手动/单阶段基线之完成时间、修订次数、可用性与偏好研究 | GeoCamera、Vinci、CreativeConnect、Anderson |
| RQ4：生成式地图的自动质量评估能否与人工判断一致？ | 自动指标、VLM 评价与人工评分相关分析 | VisEval、Munzner |

## 4. 搜索与核验策略

### 4.1 搜索来源

- ACM Digital Library / CHI、UIST 与 SIGGRAPH/TOG 的 DOI metadata 或作者公开页。
- IEEE VIS / TVCG 官方活动页、IEEE metadata、PubMed 索引及作者/学校公开条目。
- CVF Open Access（CVPR）。
- AAAI 官方 OJS。
- DBLP 与研究机构 portal 用于交叉核对书目信息。
- Taylor & Francis / IJGIS 等制图领域出版页面，用于核验与系统最直接相关但不属于指定顶会圈的补充文献。

### 4.2 使用的关键字组

```text
("map labeling" OR "label placement" OR "tourist map" OR "geographic visualization")
AND (layout OR authoring OR interactive OR storytelling)

("natural language" OR LLM OR "generative AI")
AND (visualization OR infographic OR "graphic design" OR map)

("human-AI" OR co-creation OR editable OR controllable)
AND (design OR visualization OR reference)

("style transfer" OR "procedural street" OR "visual layout")
AND (CVPR OR SIGGRAPH OR TOG OR AAAI)
```

### 4.3 纳入与排除原则

| 纳入 | 排除或降级 |
| --- | --- |
| 可直接支撑本系统之地图布局、叙事地图、视觉生成、中间表示、共创或评估设计 | 仅泛谈 LLM 或 GIS、没有设计/布局/评估连接的研究 |
| 以 CHI、VIS/TVCG、TOG/SIGGRAPH、CVPR、AAAI 为优先 | 只有博客或未能核对出版信息的项目 |
| 有 DOI、官方 proceedings、官方作者页或权威索引可核验 metadata | 只与 3D 城市/影像生成距离较远者标注为背景，不纳入核心论证 |

### 4.4 核验标记

- `V`：题名、作者、venue、年份与 DOI 已由官方/出版社、作者项目页、CVF/AAAI 或 PubMed 条目核对。
- `V*`：以 DBLP、机构 repository 或 Crossref 衍生 metadata 交叉核对；可引用，但正式投稿前宜再导出 BibTeX 做最终对照。

## 5. 核心文献矩阵

### 5.1 地图标注、布局与可视化验证

| 文献 | Venue | 与 MapLayout 的直接关系 | 应如何使用 | 核验 |
| --- | --- | --- | --- | --- |
| Shieber, Christensen, & Marks (1995), *An Empirical Study of Algorithms for Point-Feature Label Placement* | ACM TOG | 将点特征标注视为组合优化并比较 simulated annealing 等启发式方法 | 作为 SA 基线与 Overlap 优化问题的经典理论起点 | `V`, [DOI](https://doi.org/10.1145/212332.212334) |
| Been, Daiches, & Yap (2006), *Dynamic Map Labeling* | IEEE TVCG | 提出动态地图标注的一致性与交互速度需求 | 支撑视口/交互下的稳定性与“不闪动”质量讨论 | `V`, [DOI](https://doi.org/10.1109/TVCG.2006.136) |
| Afzal et al. (2012), *Spatial Text Visualization Using Automatic Typographic Maps* | IEEE TVCG / VIS | 将文字与地理结构共同生成为具有美感的地图表现 | 支撑卡片/标签不是附属物，而是叙事地图视觉构成 | `V`, [DOI](https://doi.org/10.1109/TVCG.2012.264) |
| Lin et al. (2014), *Drawing Road Networks with Mental Maps* | IEEE TVCG | 针对 tourist/destination maps，以几何与美学约束变形道路结构 | 与旅游地图情境最直接，可对照“忠实位置”与“主题表现”取舍 | `V`, [DOI](https://doi.org/10.1109/TVCG.2014.2312010) |
| Meng, Zhang, Liu, & Liu (2015), *Clutter-aware Label Layout* | IEEE PacificVis | 以 confusion、connection、distance、intersection 建立 clutter-aware label layout | 为目前仅以面积重叠为主的成本函数提供可扩展因素 | `V*`, [DOI](https://doi.org/10.1109/PACIFICVIS.2015.7156379) |
| Anderson & Robinson (2022), *Affective Congruence in Visualization Design: Influences on Reading Categorical Maps* | IEEE TVCG / VIS | 探讨地图配色与语义情境对阅读及偏好的影响 | 支撑参考图风格质量不能仅以位置/遮挡测量 | `V`, [DOI](https://doi.org/10.1109/TVCG.2021.3050118) |
| Munzner (2009), *A Nested Model for Visualization Design and Validation* | IEEE TVCG / InfoVis | 将领域问题、数据抽象、视觉/交互与算法分层验证 | 用于组织本项目的消融、算法指标与用户研究 | `V`, [DOI](https://doi.org/10.1109/TVCG.2009.111) |

### 5.2 地理叙事与交互创作

| 文献 | Venue | 与 MapLayout 的直接关系 | 应如何使用 | 核验 |
| --- | --- | --- | --- | --- |
| Li et al. (2023), *GeoCamera: Telling Stories in Geographic Visualizations with Camera Movements* | CHI 2023 | 从地理视觉内容归纳 design space，提供交互式叙事地图创作工具并开展用户研究 | 是 MapLayout 的近邻工作：同为降低地理视觉叙事创作门槛，但本项目关注静态/可编辑版面与参考风格 | `V`, [DOI](https://doi.org/10.1145/3544548.3581470) |
| Zhou, Huang, & Chan (2024), *Epigraphics: Message-Driven Infographics Authoring* | CHI 2024 | 以文字信息为 first-class object，推荐视觉元素、色彩与编辑操作 | 对应 MapLayout 的文字意图 -> 地图视觉组件映射 | `V*`, [DOI](https://doi.org/10.1145/3613904.3642172) |
| Guo et al. (2021), *Vinci: An Intelligent Graphic Design System for Generating Advertising Posters* | CHI 2021 | 自动产生视觉设计，并以编辑 feedback 更新结果 | 支撑生成后人工拖拽/修订作为研究对象 | `V*`, [DOI](https://doi.org/10.1145/3411764.3445117) |
| Choi et al. (2024), *CreativeConnect: Supporting Reference Recombination for Graphic Design Ideation with Generative AI* | CHI 2024 | 从 reference image 提取与重组可用设计元素 | 对应 MapLayout 以参考图提取视觉类而非复制内容的设计选择 | `V*`, [DOI](https://doi.org/10.1145/3613904.3642794) |
| Xie et al. (2026), *DataWink: Reusing and Adapting SVG-based Visualization Examples with Large Multimodal Models* | IEEE TVCG / VIS 2025 | 使用多模态模型理解并复用现有 SVG 可视化示例，同时为新数据进行适配 | 是“参考示例 -> 可编辑结构化产物”方向的最新核心近邻，需与 MapLayout 的地图对象/样式类映射区分 | `V`, [DOI](https://doi.org/10.1109/TVCG.2025.3634635) |

### 5.3 自然语言/生成式 AI 与可审计视觉管线

| 文献 | Venue | 与 MapLayout 的直接关系 | 应如何使用 | 核验 |
| --- | --- | --- | --- | --- |
| Setlur et al. (2016), *Eviza: A Natural Language Interface for Visual Analysis* | UIST 2016 | 以地图案例展示自然语言、空间语义与歧义修订 widget | 支撑文字旅游需求可能含歧义、需保留交互修正能力 | `V`, [DOI](https://doi.org/10.1145/2984511.2984588) |
| Narechania, Srinivasan, & Stasko (2021), *NL4DV: A Toolkit for Generating Analytic Specifications for Data Visualization from Natural Language Queries* | IEEE TVCG / VIS | 将自然语言转为 JSON analytic specifications 与 Vega-Lite specs | 与 `visual_id` / GeoJSON / style spec 中间表示论述高度相容 | `V`, [DOI](https://doi.org/10.1109/TVCG.2020.3030378) |
| Wu, Terry, & Cai (2022), *AI Chains: Transparent and Controllable Human-AI Interaction by Chaining Large Language Model Prompts* | CHI 2022 | 指出链式 LLM 工作流提高可控性与可调试性 | 直接支撑 Node 1-5 管线、版本化 prompt 与 manifest 记录 | `V`, [DOI](https://doi.org/10.1145/3491102.3517582) |
| Suh et al. (2024), *Luminate: Structured Generation and Exploration of Design Space with Large Language Models for Human-AI Co-Creation* | CHI 2024 | 以结构化生成与设计空间探索支持人机共创 | 支撑多版面候选、人工选择与修订日志的研究设计 | `V`, [DOI](https://doi.org/10.1145/3613904.3642400) |
| Vaithilingam et al. (2024), *DynaVis: Dynamically Synthesized UI Widgets for Visualization Editing* | CHI 2024 | 按用户自然语言编辑意图即时生成可操控 UI widgets | 支撑将 MapLayout 的人工调整记录为可分析的人机编辑过程，而不只是拖拽结果 | `V`, [DOI](https://doi.org/10.1145/3613904.3642639) |
| Ko et al. (2024), *Natural Language Dataset Generation Framework for Visualizations Powered by Large Language Models* | CHI 2024 | 以 LLM 将 Vega-Lite 规格转成自然语言数据集，并测量语义正确性 | 反向但相关：可启发 MapLayout 对文字意图与视觉结构映射的 faithfulness 测试 | `V*`, [DOI](https://doi.org/10.1145/3613904.3642943) |
| Chen et al. (2025), *VisEval: A Benchmark for Data Visualization in the Era of Large Language Models* | IEEE TVCG / VIS 2024 | 对 LLM 生成可视化提供 validity、legality、readability 等多维自动检查 | 强烈支撑 schema validation、分维指标与 benchmark reporting | `V*`, [DOI](https://doi.org/10.1109/TVCG.2024.3456320) |
| Wang et al. (2025), *Data Formulator 2: Iterative Creation of Data Visualizations, with AI Transforming Data Along the Way* | CHI 2025 | 将 GUI、自然语言迭代、数据线程和可复用概念结合为可视化创作界面 | 新近、强相关的 mixed-initiative authoring 基线，支撑 MapLayout 记录迭代和复用结构 | `V`, [DOI](https://doi.org/10.1145/3706598.3713296) |
| Shuai et al. (2026), *DeepVIS: Bridging Natural Language and Data Visualization Through Step-Wise Reasoning* | IEEE TVCG / VIS 2025 | 以分步推理提高自然语言至可视化的生成质量 | 与 Node 1-5 分阶段生成/验证直接可比，可为中间表示消融提供近期参照 | `V`, [DOI](https://doi.org/10.1109/TVCG.2025.3634645) |
| Shin, Hong, & Elmqvist (2025), *Visualizationary: Automating Design Feedback for Visualization Designers Using Large Language Models* | IEEE TVCG | 用 LLM 识别设计弱点并提出修复建议 | 支撑 MapLayout 在指标之外加入可解释设计反馈或修订建议的评估扩展 | `V`, [DOI](https://doi.org/10.1109/TVCG.2025.3579700) |

### 5.4 直接制图补充：高度相关但非指定顶会圈

这组研究不用于替代 CHI/VIS 核心引用，但其任务对象就是地图生成或地图设计，必须作为最直接的近邻工作进行比较。

| 文献 | Venue | 与 MapLayout 的直接关系 | 应如何使用 | 核验 |
| --- | --- | --- | --- | --- |
| Zhang et al. (2024), *MapGPT: An Autonomous Framework for Mapping by Integrating Large Language Model and Cartographic Tools* | Cartography and Geographic Information Science | 使用 LLM 调用制图工具链完成专题地图生成 | 对比 MapLayout 的差异：参考视觉输入、结构化视觉类、卡片/标签交互布局与人工修订评估 | `V`, [DOI](https://doi.org/10.1080/15230406.2024.2404868) |
| Yang et al. (2025), *MapColorAI: Designing Contextually Relevant Choropleth Map Color Schemes Using a Large Language Model* | Cartography and Geographic Information Science | 使用 LLM 根据情境设计专题地图配色，并做用户调查 | 支撑参考风格/语义一致性评价，同时提示应将配色效果独立于布局效果测量 | `V`, [DOI](https://doi.org/10.1080/15230406.2025.2531055) |
| Wang et al. (2025), *CartoAgent: A Multimodal Large Language Model-powered Multi-agent Cartographic Framework for Map Style Transfer and Evaluation* | International Journal of Geographical Information Science | 以多智能体和多模态模型进行地图风格迁移与评价 | 与 MapLayout 最接近的最新研究；论文必须明确自身在可编辑旅游叙事布局、确定性布局基准和人类修订数据方面的区别 | `V`, [DOI](https://doi.org/10.1080/13658816.2025.2507844) |

### 5.5 跨领域支撑文献：CVPR、AAAI、SIGGRAPH

下列研究可补足背景，但与“可编辑旅游地图共创”的直接距离较远，不宜取代 CHI/VIS 核心 related work。

| 文献 | Venue | 适用位置 | 核验 |
| --- | --- | --- | --- |
| Gatys, Ecker, & Bethge (2016), *Image Style Transfer Using Convolutional Neural Networks* | CVPR 2016 | 说明传统影像 style transfer 的 content/style 分离；再指出 MapLayout 转移的是结构化地图 UI 类而非像素图像 | `V`, [CVF](https://openaccess.thecvf.com/content_cvpr_2016/html/Gatys_Image_Style_Transfer_CVPR_2016_paper.html) |
| Fu, Wang, McDuff, & Song (2022), *DOC2PPT: Automatic Presentation Slides Generation from Scientific Documents* | AAAI 2022 | 作为文字/图片内容到具有版面约束之可视产物生成的相邻例子 | `V`, [AAAI](https://ojs.aaai.org/index.php/AAAI/article/view/19943) |
| Parish & Müller (2001), *Procedural Modeling of Cities* | SIGGRAPH 2001 | 仅于讨论程序化地理/城市图形生成历史时引用；本项目不生成城市路网或建筑 | `V*`, [DOI](https://doi.org/10.1145/383259.383292) |
| Chen et al. (2008), *Interactive Procedural Street Modeling* | ACM TOG / SIGGRAPH 2008 | 仅作交互约束驱动街道几何生成背景；与标注版面问题并非同一任务 | `V*`, [DOI](https://doi.org/10.1145/1360612.1360702) |

## 6. 文献对现有模块与实验的映射

| 现有模块/规划 | 最应引用的文献 | 可转化为的实验或论点 |
| --- | --- | --- |
| `VisualStructureNode` 的八类视觉中间表示 | CreativeConnect；Epigraphics；Gatys | 与 direct prompting 对照：视觉类 mapping coverage、风格一致性人工评分、修订负担 |
| 参考图到可编辑样式/地图结构的映射 | DataWink；CartoAgent；MapColorAI | 对比 SVG/地图风格迁移近邻：视觉类覆盖率、语义一致性、生成后可编辑性 |
| Node 1-5 可追踪生成 DAG、prompt version 与 manifest | AI Chains；NL4DV；DeepVIS；VisEval | 以有/无 validation、有/无中间表示进行失败率与 faithfulness 消融 |
| 卡片/标签布局与 seed 可重复管线 | Christensen；Been；Meng | 报告 Overlap、leader-line distance、Stability、runtime；增加视口/缩放稳定性测试 |
| 旅游路线与叙事地图输出 | Lin；GeoCamera；Afzal | 评估主题表现、地理可理解性与创作时间，不只评估几何精准度 |
| 参考风格与主观美感 | Anderson；Vinci；Epigraphics；MapColorAI | 建议加入风格符合度、可读性、偏好与修订次数量表 |
| 编辑循环与人工修订记录 | Data Formulator 2；DynaVis；Luminate | 记录修改轮数、操作类型、建议采纳率与完成时长 |
| 现有 `evaluate/` 指标与 VLM aesthetics | Munzner；VisEval；Visualizationary；CartoAgent | 自动评估需按层次对应 claim，并检查其与人评的一致性 |

## 7. 研究缺口与可主张的贡献空间

从已核验文献与目前代码可推导出以下空间；这些是研究定位建议，并非已经被实验验证的结论：

1. **泛化可视化共创已有结构化与迭代式进展，但旅游叙事地图仍需明确区分。** Data Formulator 2、DynaVis 与 DataWink 已覆盖自然语言编辑、混合交互和参考示例复用；MapLayout 的可辨识贡献不能仅表述为“结构化生成”，而应聚焦于“参考地图视觉类 + 地理对象锚定 + 可编辑旅游叙事布局”的组合。
2. **生成式制图已有直接近邻，布局和修订证据成为关键差异。** MapGPT、MapColorAI 与尤其是 CartoAgent 已覆盖 LLM 制图、配色和多模态地图风格迁移/评价。MapLayout 需证明其确定性卡片/标签布局、遮挡控制和人工 ground truth/修订过程带来额外价值。
3. **标注优化与生成式 authoring 的联合评估仍可强化。** Map labeling 文献提供布局准则，DeepVIS 等提供生成管线依据，但如何同时测量地图语义锚定、遮挡、风格贴合与可编辑过程仍有研究空间。
4. **可复现的生成式地图版面评估仍可建立。** VisEval、Visualizationary 与 CartoAgent 提供新的评估参照；MapLayout 已具 seed、session 与多指标基础，仍需多样本、置信区间、消融及自动指标与人评的相关性。
5. **参考风格的价值需要从美观延伸到用途。** 地图风格可能影响情绪一致性、可读性及叙事理解，不能只报告 VLM aesthetics。Anderson & Robinson 与 MapColorAI 的设计提示可转为用户研究假设。

## 8. 建议 Related Work 结构

若以 CHI 稿件为目标，Related Work 可使用以下四节：

1. **Generative cartography and geographic visualization authoring**：CartoAgent、MapGPT、MapColorAI、GeoCamera、Lin。
2. **Label placement and editable map layout**：Christensen、Been、Meng。
3. **Natural-language and generative visualization authoring**：NL4DV、DeepVIS、Data Formulator 2、DataWink、VisEval。
4. **Controllable human-AI co-creation and editing**：AI Chains、Luminate、DynaVis、CreativeConnect、Visualizationary。

若改投 VIS/TVCG，应将第 2、3、4 节提前，强化 benchmark、布局算法、验证层次及指标定义；GeoCamera/Vinci 可退为应用与设计研究背景。

## 9. 建议优先阅读顺序

| 优先级 | 文献 | 理由 |
| --- | --- | --- |
| P0 | CartoAgent (IJGIS 2025)；DataWink (TVCG/VIS 2025) | 最新、最接近参考图/地图风格复用与评价的方法近邻 |
| P0 | Data Formulator 2 (CHI 2025)；DeepVIS (TVCG/VIS 2025) | 最新自然语言与分步生成式可视化 authoring 近邻 |
| P0 | GeoCamera (CHI 2023)；Epigraphics (CHI 2024) | 地理叙事工具与文字意图驱动的视觉创作近邻 |
| P0 | Been et al. (TVCG 2006)；Shieber et al. (TOG 1995) | 建立布局基线、稳定性与质量目标 |
| P0 | VisEval (TVCG/VIS 2024-2025)；Munzner (TVCG 2009) | 建立评估方法论与自动 benchmark 论述 |
| P1 | AI Chains；Luminate；CreativeConnect | 建立可控共创与结构化中间表示论述 |
| P1 | NL4DV；Lin；Anderson；MapColorAI；Visualizationary | 支撑 structured spec、旅游地图、风格与反馈评估 |
| P2 | CVPR/AAAI/SIGGRAPH 背景条目 | 补足跨领域背景；不主导 contribution |

## 10. APA 7 参考文献清单

Afzal, S., Maciejewski, R., Jang, Y., Elmqvist, N., & Ebert, D. S. (2012). Spatial text visualization using automatic typographic maps. *IEEE Transactions on Visualization and Computer Graphics, 18*(12), 2056-2564. https://doi.org/10.1109/TVCG.2012.264

Anderson, C. L., & Robinson, A. C. (2022). Affective congruence in visualization design: Influences on reading categorical maps. *IEEE Transactions on Visualization and Computer Graphics, 28*(8), 2867-2878. https://doi.org/10.1109/TVCG.2021.3050118

Been, K., Daiches, E., & Yap, C. (2006). Dynamic map labeling. *IEEE Transactions on Visualization and Computer Graphics, 12*(5), 773-780. https://doi.org/10.1109/TVCG.2006.136

Chen, G., Esch, G., Wonka, P., Müller, P., & Zhang, E. (2008). Interactive procedural street modeling. *ACM Transactions on Graphics, 27*(3), 1-10. https://doi.org/10.1145/1360612.1360702

Chen, N., Zhang, Y., Xu, J., Ren, K., & Yang, Y. (2025). VisEval: A benchmark for data visualization in the era of large language models. *IEEE Transactions on Visualization and Computer Graphics, 31*(1), 1301-1311. https://doi.org/10.1109/TVCG.2024.3456320

Choi, D., Hong, S., Park, J., Chung, J. J. Y., & Kim, J. (2024). CreativeConnect: Supporting reference recombination for graphic design ideation with generative AI. In *Proceedings of the 2024 CHI Conference on Human Factors in Computing Systems*. ACM. https://doi.org/10.1145/3613904.3642794

Fu, T.-J., Wang, W. Y., McDuff, D., & Song, Y. (2022). DOC2PPT: Automatic presentation slides generation from scientific documents. *Proceedings of the AAAI Conference on Artificial Intelligence, 36*(1), 634-642. https://doi.org/10.1609/aaai.v36i1.19943

Gatys, L. A., Ecker, A. S., & Bethge, M. (2016). Image style transfer using convolutional neural networks. In *Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition* (pp. 2414-2423).

Guo, S., Jin, Z., Sun, F., Li, J., Li, Z., Shi, Y., & Cao, N. (2021). Vinci: An intelligent graphic design system for generating advertising posters. In *Proceedings of the 2021 CHI Conference on Human Factors in Computing Systems*. ACM. https://doi.org/10.1145/3411764.3445117

Ko, H.-K., Jeon, H., Park, G., Kim, D. H., Kim, N. W., Kim, J., & Seo, J. (2024). Natural language dataset generation framework for visualizations powered by large language models. In *Proceedings of the 2024 CHI Conference on Human Factors in Computing Systems*. ACM. https://doi.org/10.1145/3613904.3642943

Li, W., Wang, Z., Wang, Y., Weng, D., Xie, L., Chen, S., Zhang, H., & Qu, H. (2023). GeoCamera: Telling stories in geographic visualizations with camera movements. In *Proceedings of the 2023 CHI Conference on Human Factors in Computing Systems* (Article 170, pp. 1-15). ACM. https://doi.org/10.1145/3544548.3581470

Lin, S.-S., Lin, C.-H., Hu, Y.-J., & Lee, T.-Y. (2014). Drawing road networks with mental maps. *IEEE Transactions on Visualization and Computer Graphics, 20*(9), 1241-1252. https://doi.org/10.1109/TVCG.2014.2312010

Meng, Y., Zhang, H., Liu, M., & Liu, S. (2015). Clutter-aware label layout. In *2015 IEEE Pacific Visualization Symposium (PacificVis)* (pp. 207-214). IEEE. https://doi.org/10.1109/PACIFICVIS.2015.7156379

Munzner, T. (2009). A nested model for visualization design and validation. *IEEE Transactions on Visualization and Computer Graphics, 15*(6), 921-928. https://doi.org/10.1109/TVCG.2009.111

Narechania, A., Srinivasan, A., & Stasko, J. (2021). NL4DV: A toolkit for generating analytic specifications for data visualization from natural language queries. *IEEE Transactions on Visualization and Computer Graphics, 27*(2), 369-379. https://doi.org/10.1109/TVCG.2020.3030378

Parish, Y. I. H., & Müller, P. (2001). Procedural modeling of cities. In *Proceedings of SIGGRAPH 2001* (pp. 301-308). ACM. https://doi.org/10.1145/383259.383292

Setlur, V., Battersby, S. E., Tory, M., Gossweiler, R., & Chang, A. X. (2016). Eviza: A natural language interface for visual analysis. In *Proceedings of the 29th Annual Symposium on User Interface Software and Technology* (pp. 365-377). ACM. https://doi.org/10.1145/2984511.2984588

Shieber, S. M., Christensen, J., & Marks, J. (1995). An empirical study of algorithms for point-feature label placement. *ACM Transactions on Graphics, 14*(3), 203-232. https://doi.org/10.1145/212332.212334

Shin, S., Hong, S., & Elmqvist, N. (2025). Visualizationary: Automating design feedback for visualization designers using large language models. *IEEE Transactions on Visualization and Computer Graphics, 31*(10), 8796-8813. https://doi.org/10.1109/TVCG.2025.3579700

Shuai, Z., Li, B., Yan, S., Luo, Y., & Yang, W. (2026). DeepVIS: Bridging natural language and data visualization through step-wise reasoning. *IEEE Transactions on Visualization and Computer Graphics, 32*(1), 868-878. https://doi.org/10.1109/TVCG.2025.3634645

Suh, S., Chen, M., Min, B., Li, T. J.-J., & Xia, H. (2024). Luminate: Structured generation and exploration of design space with large language models for human-AI co-creation. In *Proceedings of the 2024 CHI Conference on Human Factors in Computing Systems*. ACM. https://doi.org/10.1145/3613904.3642400

Vaithilingam, P., Glassman, E. L., Inala, J. P., & Wang, C. (2024). DynaVis: Dynamically synthesized UI widgets for visualization editing. In *Proceedings of the 2024 CHI Conference on Human Factors in Computing Systems*. ACM. https://doi.org/10.1145/3613904.3642639

Wang, C., Kang, Y., Gong, Z., Zhao, P., Feng, Y., Zhang, W., & Li, G. (2025). CartoAgent: A multimodal large language model-powered multi-agent cartographic framework for map style transfer and evaluation. *International Journal of Geographical Information Science, 39*(9). https://doi.org/10.1080/13658816.2025.2507844

Wang, C., Lee, B., Drucker, S. M., Marshall, D., & Gao, J. (2025). Data Formulator 2: Iterative creation of data visualizations, with AI transforming data along the way. In *Proceedings of the 2025 CHI Conference on Human Factors in Computing Systems*. ACM. https://doi.org/10.1145/3706598.3713296

Wu, T., Terry, M., & Cai, C. J. (2022). AI Chains: Transparent and controllable human-AI interaction by chaining large language model prompts. In *Proceedings of the 2022 CHI Conference on Human Factors in Computing Systems*. ACM. https://doi.org/10.1145/3491102.3517582

Xie, L., Lin, Y., Liu, C., Qu, H., & Shu, X. (2026). DataWink: Reusing and adapting SVG-based visualization examples with large multimodal models. *IEEE Transactions on Visualization and Computer Graphics, 32*(1), 824-834. https://doi.org/10.1109/TVCG.2025.3634635

Yang, L., Wang, Y., Wei, Z., & Wu, F. (2025). MapColorAI: Designing contextually relevant choropleth map color schemes using a large language model. *Cartography and Geographic Information Science*. Advance online publication. https://doi.org/10.1080/15230406.2025.2531055

Zhang, Y., He, Z., Li, J., Lin, J., Guan, Q., & Yu, W. (2024). MapGPT: An autonomous framework for mapping by integrating large language model and cartographic tools. *Cartography and Geographic Information Science, 51*(6), 717-743. https://doi.org/10.1080/15230406.2024.2404868

Zhou, T., Huang, J., & Chan, G. Y.-Y. (2024). Epigraphics: Message-driven infographics authoring. In *Proceedings of the 2024 CHI Conference on Human Factors in Computing Systems*. ACM. https://doi.org/10.1145/3613904.3642172

## 11. 核验来源入口

下列来源页面提供本轮书目确认与摘要判断的主要依据：

- [GeoCamera 作者项目页](https://shellywhen.github.io/projects/GeoCamera)
- [VisEval Microsoft Research 页面](https://www.microsoft.com/en-us/research/publication/viseval-a-benchmark-for-data-visualization-in-the-era-of-large-language-models/)
- [NL4DV 机构出版记录](https://researchportal.hkust.edu.hk/en/publications/nl4dv-a-toolkit-for-generating-analytic-specifications-for-data-v/)
- [Dynamic Map Labeling - PubMed](https://pubmed.ncbi.nlm.nih.gov/17080799/)
- [Drawing Road Networks with Mental Maps - PubMed](https://pubmed.ncbi.nlm.nih.gov/26357374/)
- [Spatial Text Visualization - University of Arizona metadata](https://experts.arizona.edu/en/publications/spatial-text-visualization-using-automatic-typographic-maps/)
- [Point-Feature Label Placement - Harvard DASH](https://dash.harvard.edu/entities/publication/73120378-7f0c-6bd4-e053-0100007fdf3b)
- [A Nested Model for Visualization Design and Validation - PubMed](https://pubmed.ncbi.nlm.nih.gov/19834155/)
- [Affective Congruence - Penn State publication record](https://pure.psu.edu/en/publications/affective-congruence-in-visualization-design-influences-on-readin)
- [Eviza - Tableau Research](https://www.tableau.com/research/publications/eviza-natural-language-interface-visual-analysis)
- [Luminate project repository with ACM citation](https://github.com/project-luminate/luminate)
- [CVPR 2016 official open-access record for Gatys et al.](https://openaccess.thecvf.com/content_cvpr_2016/html/Gatys_Image_Style_Transfer_CVPR_2016_paper.html)
- [DOC2PPT - AAAI official page](https://ojs.aaai.org/index.php/AAAI/article/view/19943)
- [DataWink - HKUST publication record](https://researchportal.hkust.edu.hk/en/publications/datawink-reusing-and-adapting-svg-based-visualization-examples-wi/)
- [DeepVIS - official project bibliography](https://repo.vicayang.cc/DeepVIS/bib.html)
- [Visualizationary - Aarhus University publication record](https://pure.au.dk/portal/en/publications/visualizationary-automating-design-feedback-for-visualization-des/)
- [Data Formulator 2 - Yonsei University publication record](https://yonsei.elsevierpure.com/en/publications/data-formulator-2-iterative-creation-of-data-visualizations-with-/)
- [DynaVis - Priyan Vaithilingam publication page](https://priyan.info/)
- [MapGPT - Taylor & Francis official record](https://www.tandfonline.com/doi/abs/10.1080/15230406.2024.2404868)
- [MapColorAI - Taylor & Francis official record](https://www.tandfonline.com/doi/abs/10.1080/15230406.2025.2531055)
- [CartoAgent - Taylor & Francis official record](https://www.tandfonline.com/doi/abs/10.1080/13658816.2025.2507844)
