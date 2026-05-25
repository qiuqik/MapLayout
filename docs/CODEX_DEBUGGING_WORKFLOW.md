# MapLayout 在 Codex 中的调试与验证方法

更新日期：2026-05-25

适用环境：前端 `http://localhost:3000`，后端 `http://0.0.0.0:8000`，后端 Conda 环境 `aiagent`。

## 1. 基本原则

本项目包含 LLM/VLM 后端、交互式地图前端与离线评估模块，调试应遵循三条原则：

1. 将“功能可运行”“实验可复现”“视觉效果更好”分开验证，三者不是同一件事。
2. 每次只完成一个可验收改动，验证后单独 commit，避免无法定位结果变化来源。
3. 不将开发热更新、已有会话状态或网络模型波动误认为算法效果。

## 2. 开始任务前的检查

### 2.1 观察代码状态

在 Codex 中先读取状态和最近提交，确认是否有未完成试验：

```bash
git status --short --branch
git log --oneline -12
git diff --stat
```

规则：

- 已有未提交修改应先理解其来源，不应随意还原。
- 新任务如果与这些修改无关，仅暂存新任务文件。
- 涉及布局质量时，应先记录当前可见效果与对应 commit，方便比较。

### 2.2 明确三个服务面

| 模块 | 位置 | 主要检查方式 |
| --- | --- | --- |
| 后端 Agent | `server/` | `conda run -n aiagent python -m py_compile ...`、API/manifest 检查 |
| 前端地图 | `web/` | TypeScript、Next 构建、浏览器交互验证 |
| 指标评估 | `evaluate/` | 离线批量 smoke test、JSON/CSV 结果检查 |

## 3. 后端调试

### 3.1 快速语法与导入检查

后端修改后，优先使用用户指定的 Conda 环境：

```bash
conda run -n aiagent python -m py_compile \
  server/app.py \
  server/src/multi_modal_agent.py \
  server/src/nodes/*.py \
  server/src/schemas/*.py \
  server/src/validators/*.py
```

适合发现：

- 导入路径错误。
- Prompt loader 或 schema 新增后的语法问题。
- API 返回字段修改导致的基础加载问题。

### 3.2 Manifest 和中间输出检查

生成请求完成后，重点核对 session 目录中的：

```text
session_manifest.json
node1/
node2/
node3/
node4/
```

检查项目：

| 检查项 | 目的 |
| --- | --- |
| `prompt_versions` 是否存在 | 确认实验使用的 prompt 版本 |
| 节点耗时和总耗时是否记录 | 支撑性能分析 |
| validation 结果和重试次数 | 区分生成失败与布局失败 |
| Node 3 feature mapping | 确认视觉元素可追踪到地理对象 |
| API 的 `files` 字段 | 确认前端/脚本可以稳定定位工件 |

### 3.3 避免直接依赖在线模型做基础回归

结构、解析或序列化改动，应先使用已有 session 文件或合成小样例验证。只有当变更涉及真实生成效果时，才运行需要模型调用的新请求；这样可以避免将网络/模型随机波动混入代码回归判断。

## 4. 前端与布局调试

### 4.1 静态检查和生产构建

```bash
cd web
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/next build --webpack
```

说明：

- 本项目中 `next build --webpack` 可避开受限执行环境下 Turbopack 端口绑定问题。
- 构建可能自动将 `web/next-env.d.ts` 的 `.next/dev/types/routes.d.ts` 改成 `.next/types/routes.d.ts`；若该变更只是构建产物且不属于任务，应在提交前排除。
- `npm run lint` 当前会因未安装 `eslint` 可执行文件而失败，这是待补齐的工具链任务，不应伪报为 lint 通过。

### 4.2 在浏览器中检查正在运行的页面

命令行环境可能无法直接访问用户已启动的 `localhost:3000`。此时在 Codex 中使用浏览器能力打开或接管：

```text
http://localhost:3000/agent
```

界面修改至少检查：

| 操作 | 观察内容 |
| --- | --- |
| 全新加载 `/agent` | 页面可见，无 hydration/runtime error |
| 切换 `Force`、`SA`、`Voronoi` | 布局确实重算，控制状态正确 |
| 修改 `Random Seed` | 数值可控，重复运行条件可记录 |
| 保存 layout/groundtruth | 仅在需要验证保存链路时执行，确认 metadata 写出 |
| 查看控制台 error | 区分持续错误与 hot reload 瞬时 mismatch |

开发服务器热更新时可能出现一次旧 HTML 与新客户端代码不同步的 hydration warning。判断是否为真实回归的方法是：新开一个干净页面加载当前代码并再次检查控制台；若仍出现错误，才视为需要修复的缺陷。

### 4.3 调试布局质量的正确方式

布局改动不能只用“页面还能打开”判定成功。建议固定以下条件：

```text
session + viewport + algorithm/pipeline + parameters + seed + source commit
```

然后比较：

- 标签/卡片之间是否重叠。
- 是否遮挡路线、区域或全局元素。
- Leader line 是否过长或杂乱。
- 与人工调整结果的接近程度。
- 运行耗时和不同 seed 下的稳定性。

特别是 Voronoi 初始化问题，应比较：

| 条件 | 意义 |
| --- | --- |
| 直接 Voronoi 从 anchor 启动 | 当前可复现基线 |
| 用户手动先 Force 再 Voronoi | 观察到的效果参考 |
| 显式确定性 `Force -> Voronoi` pipeline | 已验收的提出方法；后续在 P2 扩展多案例报告 |

只有第三种同时接近第二种效果、并保持重复运行一致，才应作为论文方法与正式实现提交。

## 5. 离线评估调试

### 5.1 列出与批量评估 sessions

在仓库根目录运行：

```bash
conda run -n aiagent python evaluate/index.py --list-sessions

conda run -n aiagent python evaluate/index.py \
  --sessions all \
  --skip-aesthetics \
  --json-out /tmp/maplayout_eval_smoke.json \
  --csv-out /tmp/maplayout_eval_smoke.csv
```

`--skip-aesthetics` 适合代码回归与离线 smoke test，避免在线 VLM 评价使验证变慢或受网络影响。

### 5.2 指标解释

| 指标 | 趋势 | 调试用途 |
| --- | --- | --- |
| Overlap | 越低越好 | 最直接捕捉遮挡回退 |
| Utility | 越高越好 | 判断地图空间利用情况 |
| Balance | 越高越好 | 判断布局是否过于偏置 |
| MeanIoU | 越高越好 | 与人工 Ground Truth 比较 |
| Stability | 越高越好 | 多 seed/重复运行稳定性 |
| MeanTime | 越低越好 | 判断 pipeline 成本 |
| Aesthetics | 越高越好 | 最后阶段的视觉判断，不作为快速回归门槛 |

### 5.3 改动评估模板

每次算法修改建议记录：

```text
基线 commit：
候选 commit / 工作区说明：
sessions：
algorithms/pipelines：
seeds：
构建与页面验证：
指标差异：
代表性截图：
结论：提交 / 继续调整 / 放弃候选
```

## 6. 提交工作流

遵循“一任务、一验收、一 commit”：

1. 查看 `git diff`，确认改动范围与任务一致。
2. 运行本任务所需验证，并记录无法运行的检查及原因。
3. 只 `git add` 本任务文件，不顺带加入进行中的试验。
4. 使用描述结果而非过程的提交信息。

示例：

```bash
git add docs/CHI_ROADMAP.md docs/CODEX_DEBUGGING_WORKFLOW.md README.md
git commit -m "Document CHI roadmap and debugging workflow"
```

适合后续算法工作的提交信息：

```text
Restore deterministic Force-initialized Voronoi layout
Add reproducible layout experiment runner
Add layout benchmark reporting
```

## 7. 当前已知调试事项

| 项目 | 状态 | 后续动作 |
| --- | --- | --- |
| Voronoi 直接初始化效果低于先 Force 后 Voronoi | P0 已以显式 `Force + Voronoi` pipeline 修复并完成单案例验收 | P2 扩展多 session 固定协议与统计报告 |
| 前端 lint 无法运行 | `eslint` 未安装或未纳入依赖 | 单独补齐 lint 工具链并建立检查 |
| 命令行对用户运行中的 3000 端口不可达 | 已知环境限制 | 使用 Codex 浏览器或 Chrome 进行实际界面验证 |
| 在线 VLM/LLM 调用可能影响调试稳定性 | 持续存在 | 基础回归优先使用已有 session 与离线指标 |
