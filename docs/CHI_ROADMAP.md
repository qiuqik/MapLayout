# MapLayout CHI 改进路线与完成记录

更新日期：2026-05-25

代码基线：`03488bd Add reproducible layout seeds`

目标：将当前工程能力组织成可论证、可复现、可评估的 CHI 投稿系统研究。

## 1. 研究定位

当前系统已经具备从文本需求与视觉参考图生成专题地图的完整链路：

`意图丰富 -> 视觉结构抽取 -> GeoJSON 生成与验证 -> 样式生成 -> 交互式布局与人工调整 -> 指标评估`

论文的核心不应只表述为“多 Agent 生成地图”，而应进一步抽象为：

> 一种以结构化中间表示连接视觉参考、地理内容和交互式布局的可审计地图共创流程，并通过自动指标与人工修订结果评估生成质量。

这一定义能把现有架构中的三项真实能力对齐到研究贡献：

| 工程能力 | 可论证的研究角色 | 尚需补强 |
| --- | --- | --- |
| 节点式多模态生成链路 | 结构化、可追踪的地图合成过程 | 明确每个中间表示对结果质量的贡献 |
| 自动布局与人工 Ground Truth | AI 建议与人类修订之间的交互工作流 | 恢复布局效果，并建立可重复的对照实验 |
| `evaluate/` 指标体系 | 对布局质量、稳定性与耗时的量化评估 | 批量运行、统计检验、用户研究协议 |

## 2. 当前完成计划

以下内容均已作为独立 commit 提交，不包含当前工作区中的未提交试验。

| 状态 | Commit | 已完成内容 | 对论文/实验的价值 | 验证记录 |
| --- | --- | --- | --- | --- |
| 完成 | `524d878` | 评估入口支持批量 session、JSON/CSV 汇总、离线跳过美学指标、严格模式；修正耗时方向和缺失运行数据处理 | 可以规模化跑基线指标并导出分析表 | 使用 `--sessions all --skip-aesthetics` 跑通现有 4 个 session |
| 完成 | `fd06434` | Agent 写出 `session_manifest.json`，记录文件、总耗时和节点耗时 | 每次生成可审计，便于复现实验样本 | 后端编译检查与 SessionManager smoke test |
| 完成 | `85e01b4` | 前端保存布局算法、参数、运行耗时、视口等 metadata | 布局文件不再是无上下文结果 | TypeScript 检查与 Next 生产构建 |
| 完成 | `419c5c2` | 为视觉结构、GeoJSON、样式中间输出增加 Pydantic schema 与非阻断校验 | 支持分析中间表示可靠性 | 对已有样例文件运行校验 |
| 完成 | `7de2c71` | manifest 记录各节点 prompt 名称和版本 | 可报告 prompt 版本，减少实验漂移 | 后端编译及 manifest smoke test |
| 完成 | `9af1375` - `b572bbc` | 将五个核心节点 prompt 外置到 `server/prompts/` | Prompt 可版本化、可消融、可附录公开 | 后端编译及 prompt 加载检查 |
| 完成 | `f6785b7` | GeoJSON 特征增加稳定 `feature_id`、语义角色与视觉内容映射 | 为“视觉结构如何作用于地图对象”提供追踪依据 | 合成 FeatureCollection 映射检查 |
| 完成 | `7dd65ef` | Agent API 返回结构化输出文件字段 | 前端/实验脚本更易消费生成工件 | 后端编译检查 |
| 完成 | `03488bd` | 三种布局路径加入可控 seed；保存 seed 与初始化策略 | 为布局稳定性和多次重复实验建立基础 | TypeScript、Next 构建、浏览器控件交互检查 |
| 完成 | 本次提交：`Restore deterministic Force-initialized Voronoi layout` | 将直接 Voronoi 暴露为实验基线，并将提出方法固定为显式 `Force -> Voronoi -> refinement` pipeline | 恢复低遮挡布局质量，同时保留可重复对照条件 | 固定重庆 session、`seed=1` 重跑/保存/指标比较；TypeScript、Next 构建、Chrome 检查 |

## 3. 已验收的 P0 修复

### P0：恢复 Voronoi 的布局质量，同时保留可复现性

用户观察：在界面中先运行 Force，再切换到 Voronoi 时，布局视觉效果优于直接从锚点启动 Voronoi。上一轮为了去掉历史状态依赖，将这个有效初始化也去掉了，造成可见效果退化。

修复将隐含的用户操作序列显式化为确定性 pipeline，并保留可直接选择的对照基线：

`Force(seed, params) -> Weighted Voronoi(seed, params) -> Force refinement`

这样既保留 Force 初始化带来的效果，又不依赖用户此前是否点击过某个按钮。

验收条件：

1. 同一 session、视口、参数与 seed 重复执行，输出坐标一致或在浮点容差内一致。
2. 与 `03488bd` 的直接 Voronoi 相比，至少在已有 session 的 Overlap、MeanIoU 或人工可读性观察上无明显退化，且展示典型案例。
3. 保存的 metadata 明确记录 pipeline、Force 初始化参数、Voronoi 参数与 seed。
4. 类型检查、生产构建、浏览器切换/保存流程通过后，才提交独立 commit。

验收记录：

| 条件 | Overlap（越低越好） | MeanIoU（越高越好） | 同 seed 重跑 |
| --- | ---: | ---: | --- |
| `Voronoi Base`：anchor 初始化，对应 `03488bd` 直启行为 | 0.0406 | 0.5504 | 渲染框坐标差 `0px` |
| `Force + Voronoi`：显式三阶段 pipeline | 0.0276 | 0.4470 | 渲染框坐标差 `0px`；保存经纬度差 `0` |

实验条件：`20260327_220636_session_1774620396`、Chrome 相同稳定视口、`seed=1`，以保存的 layout GeoJSON 对同一 Ground Truth 运行 `evaluate/index.py` 的 `calc_overlap` 与 `calc_mean_iou`。

结论：pipeline 的 Overlap 相比直接基线降低约 32%，且重复输出一致，因此满足 P0 的低遮挡和可复现验收条件。MeanIoU 出现下降，表明当前方法在降低线路/对象遮挡与贴近人工位置之间存在取舍；后续 P2 应在固定多 session 协议中报告这一取舍，而非只报告有利指标。

保存 metadata 已明确写出 `pipeline`、`initialization`、`seed`、`forceInitializer`、`voronoi` 与 `forceRefinement` 参数。

## 4. 后续实施路线

优先顺序按“先恢复结果质量，再形成证据链，再准备研究评估”排列。每一步都应单独完成测试与 commit。

### P1：可复现布局批处理器

目标：自动生成同一 session 在不同算法、参数和 seed 下的布局结果，不依赖手动操作前端。

代码工作：

- 抽取或复用可在测试环境调用的布局运行接口。
- 增加实验配置文件，至少包含 `session_id`、算法、seed 列表、参数组和输出目录。
- 生成的 GeoJSON 附带算法、pipeline、seed、运行时、视口及源码 commit。
- 输出 run manifest，能与 `evaluate/index.py` 的汇总结果关联。

评估与测试：

- 对 Force、SA、Force-initialized Voronoi 各运行多个 seed。
- 对相同 seed 重跑，验证输出哈希或坐标容差。
- 使用 `evaluate/index.py` 汇总 JSON/CSV。

建议 commit：`Add reproducible layout experiment runner`

### P2：布局指标与对照协议

目标：使论文中的布局结论可以由固定协议重跑。

代码工作：

- 将基线、提出方法、人工 Ground Truth 的对应关系显式写入评估配置。
- 输出每个 run 的 Overlap、Utility、Balance、MeanIoU、Stability、MeanTime，并标注优化方向。
- 将 Aesthetics 拆分为可选的在线 VLM 评价阶段，避免阻塞离线回归测试。
- 增加按算法和场景汇总均值、标准差与置信区间的结果导出。

评估与测试：

- 固定测试 sessions 和 seeds，形成小型 regression suite。
- 在算法改动前后运行相同配置，保存差异表和代表性截图。

建议 commit：`Add layout benchmark reporting`

### P3：中间表示的可解释映射与消融支持

目标：支撑“结构化中间表示为何有效”的方法贡献。

代码工作：

- 为 Node 2 的视觉元素、Node 3 的 feature、Node 4 的样式规则建立完整引用链。
- 在 manifest 中记录校验告警、修复次数与映射覆盖率。
- 增加可配置消融：不使用视觉结构、去掉 validation、去掉 feature mapping、只使用单阶段布局。

评估与测试：

- 确认所有已有样例均能生成映射覆盖率报告。
- 评估消融对布局指标、样式一致性与失败率的影响。

建议 commits：

- `Report intermediate representation coverage`
- `Add ablation experiment configurations`

### P4：交互过程与用户研究支持

目标：将“人工可编辑”从界面能力转成 HCI 可评估过程。

代码工作：

- 记录任务开始/结束、算法建议、拖拽修正次数、保存次数和完成时长。
- 区分系统建议布局与用户最终修订布局，保留匿名任务日志。
- 增加实验管理员可导出的任务包和结果包。

研究准备：

- 明确任务条件：手动布局、Force 基线、提出方法。
- 明确因变量：完成时长、修订次数、主观量表、布局指标。
- 准备伦理与隐私处理方案，避免记录不必要的个人信息。

建议 commit：`Record layout editing study events`

### P5：投稿复现包与演示稳定性

目标：让审稿人和研究团队可重复复核系统结果。

代码工作：

- 提供一键运行说明、固定样例、环境清单和评估命令。
- 冻结 prompt 版本、模型配置、算法参数、seed 与生成文件索引。
- 增加失败降级说明，例如无法访问远端模型时仅运行已有 session 的布局评估。

建议 commit：`Document reproducible CHI artifact workflow`

## 5. 每步完成标准

每一个后续实现任务按以下顺序执行：

1. 在改动前记录基线结果、截图或失败复现步骤。
2. 只实现当前目标需要的最小代码改动。
3. 运行与改动范围对应的自动验证。
4. 若涉及界面，使用 chrome 浏览器在 `http://localhost:3000/agent` 上验证关键交互与控制台错误。
5. 若涉及布局质量，用固定 session 和 seed 与基线比较，而不是只凭单次目测判断。
6. 在结果满足验收标准后提交一条内容明确的 commit。
7. 在本文件的完成表中补充 commit、测试命令与结论。

## 6. 论文证据清单

在进入正式写作或用户研究前，项目至少需要产出：

| 证据 | 当前状态 | 对应计划 |
| --- | --- | --- |
| 结构化生成管线、prompt 版本、session manifest | 已具备基础 | 已完成 |
| 可复现且降低重叠的提出布局方法 | 已完成 P0 单案例验收，待 P2 扩展固定基准 | P0 / P2 |
| 多算法多 seed 的自动批量结果 | 缺失 | P1 |
| 固定协议的指标表、方差/置信区间、案例图 | 缺失 | P2 |
| 中间表示作用的消融结果 | 缺失 | P3 |
| 用户修订过程数据与主观评价 | 缺失 | P4 |
| 可供复核的 artifact package | 缺失 | P5 |
