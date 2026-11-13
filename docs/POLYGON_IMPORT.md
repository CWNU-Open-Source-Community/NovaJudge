# Polygon 题包导入

后台 **Import Problems** 的 **Import Format** 可选择 **Polygon ZIP (Linux / Windows)**，
**Import Contests** 可选择 **Polygon Contest ZIP (problems only)**。
两个入口的 Polygon 导入都只将题目新增到题库；本平台的比赛由管理员自行创建，再选择题库中的题目。
原来的 **NovaJudge ZIP** 格式继续可用。

## 从 Polygon 导出

优先下载 **Linux** 包，也支持 **Windows** 包。必须包含已经生成的完整测试输入、标准答案和
C++ checker 源码。Polygon 的 **standard** 包通常没有生成后的数据；导入器不会执行生成器、
标程或打包脚本，缺少任意测试文件时会显示文件名并拒绝导入。
交互题、包含交互轮次的通信题还需包含 C++ interactor 源码。

典型结构（可以整体套一层目录，不要求 ZIP 显式包含目录记录）：

```text
problem.xml
tests/01
tests/01.a
tests/02
tests/02.a
files/check.cpp
statements/.html/english/problem.html
statements/.html/english/figure.png
statements/english/problem-properties.json
```

导入依据 `problem.xml` 中 `judging/testset` 的路径模式定位数据，不依赖固定的测试文件名。
优先使用名为 `tests` 的测试集；只有一个测试集时也支持其他名称。

## 导入题目

支持单题 ZIP、多题目录组成的 ZIP，以及将多个下载好的题目 ZIP 再打包成一个 ZIP。
导入后每道题目获得新 ID。

- 从 XML 提取名称、时间限制（毫秒）和内存限制（字节转换为 MiB）。
- 导入每个测试输入和标准答案，生成 `data/problem.yml` 以及对应的数据库判题配置。
- 保留包里的 C++ testlib checker，包括 Polygon 标准 checker；以 `spj` 类型运行，
  避免把数值、浮点误差或自定义判定误换成本平台普通文本比较。
- 自动识别交互题（`interactive`）和 `run-count="2"` 的通信题（`communication`），
  导入 checker、interactor 和交互轮次，保留 Polygon 的输出传递与最终判定协议。
- 本地双引号 include 的辅助头文件会内联到 checker/interactor；`testlib.h` 使用服务器随附版本。
- 优先选择中文 HTML，其次英文 HTML，再选择其他语言的 HTML；转换为 Markdown，
  保留公式、列表和表格，迁移引用的图片和题面附件，并重写为新题目的资源 URL。
- 按 Polygon HTML 的题面结构生成 NovaJudge 原生 Block：`Problem Description`、`Input`、
  `Output`、`Interaction`、`Note` 等分别保存为独立 section，可在编辑器中单独编辑、改名或删除。
  自定义章节保留原标题和顺序，通信题的重复 Input/Output 章节也分别保留；缺少结构标记的 HTML
  使用 `Problem Description` Block 保留完整内容。
- 普通题从 `problem-properties.json` 的 `sampleTests` 获取题面样例；否则使用 `sample="true"` 的测试。
  交互/通信题的公开对话与两轮示例保留在独立的 `Examples` Block 中；原始测试输入和答案只保存在私有数据目录。
  管理员样例调试使用 `polygon.sample_cases` 指向的 `sample="true"` 测试，不把公开对话当成裁判输入。
- 只有 PDF 或 LaTeX 题面时保存为附件并提示检查；没有题面时也会显示警告，发布前需补齐。

## 导入 Polygon 比赛导出的题目包

在 Polygon 创建比赛后，导出整场比赛的题目 ZIP，直接上传即可批量导入其中的题目，
无需在本平台填写比赛名称、开始时间或结束时间。两个入口均支持比赛题包。

支持以下两种结构：

1. `contest.xml` 加题目目录或题目 ZIP：按 `problems/problem` 的顺序导入，
   `index` 转为大写后在结果中显示为原题号；通过相对 `path`、题目 URL 或唯一 short-name 匹配本地题包。
   仅有 `contest.xml` 中的远程链接不够，必须同时提供题包。
2. 没有 `contest.xml` 的单题或多题包：按文件名自然排序导入；比赛包入口在结果中标注 A、B、…、Z、AA 等编号供核对。

导入结果显示题目数量，以及“原题号 → 新题目 ID”的对应关系。题包中的比赛信息只用于解析题目，
不会创建或修改本平台的比赛，也不会自动建立比赛与题目的关联。管理员随后在后台自行创建比赛，
设置名称、日程及其他配置，并把本次导入的题目加入比赛。

例如，Polygon 比赛包中有 A、B、C 三题，上传后题库新增三道题目，比赛列表不变。
原有 **NovaJudge ZIP** 比赛备份导入仍按原逻辑恢复比赛。

API 的 `/api/problems/import` 和 `/api/contests/import` 均接受 multipart 字段 `file`
和 `format=polygon`，无需 `title`、`startTime`、`endTime`。返回 `importedProblems` 列表；
比赛包入口返回的 `importedContests` 为空数组。未传 `format` 或传 `auto` 时按包内容识别；
`native` 强制使用原有格式。

## 支持边界与错误处理

支持标准输入输出、ACM/ICPC 判定的普通题、交互题和两轮通信题：

| Polygon 配置 | 导入题型 | 执行流程 |
| --- | --- | --- |
| 单轮，无 interactor | spj | 选手程序 → checker |
| 单轮，有 interactor | interactive | 选手 ↔ interactor → tout → checker |
| 两轮，无 interactor | communication | 第一轮 stdout → 第二轮 stdin → checker |
| 两轮，仅首轮交互 | communication | 第一轮选手 ↔ interactor → tout → 第二轮 stdin → checker |
| 两轮都交互 | communication | 第一轮选手 ↔ interactor → tout → 第二轮 interactor ↔ 选手 → tout → checker |

`assets/interactor/runs/run` 指定交互轮次；省略 `runs` 时默认为第一轮。
Interactor 使用 `registerInteraction` 的 input / tout / answer 接口；最终 checker 始终收到原始测试输入、
最后一轮的 stdout 或 tout、标准答案。任意一轮失败立即结束该测试，两轮分别使用完整时间和内存限制，
只传递协议规定的输出，不共享选手文件或进程状态。

导入后的 `problem.yml` 保存 `polygon.run_count`、`polygon.interactor_runs` 和 `polygon.sample_cases`。
无需另外编写本平台的 `communicator.cpp`。两轮通信中，非交互轮次的 stdout 输出上限沿用
`communication.output_limit`（默认 1 MiB），可在数据管理中调整至 16 MiB。
交互轮次的双向对话完整传输，由 interactor 检查询问次数、消息长度和通信内容；不将累计对话大小
当作普通输出文件大小限制。后台只保留每个方向前 64 KiB 的对话预览，超出时标注截断，
不影响判定。Interactor 写入的 `tout` 独立传给下一轮或 checker，文件上限为 16 MiB。

以下包会明确拒绝：

- `run-count` 超出 1、2，或交互轮次与运行次数不一致的包。
- 指定输入输出文件名的题目、分组/部分分计分题。
- 非 C++ 或非 testlib checker/interactor、缺失的裁判源码/本地头文件。
- 缺失输入或答案、非法路径、损坏 ZIP/XML、重复路径或无法唯一匹配的比赛题目。

Polygon 可能在普通 ACM/ICPC 题的测试点上写出 `points="0.0"`。
全零的 points 元数据与空的 groups 节点可以导入，所有测试点仍参与判定；
只有实际非零测试分数、分组计分或 checker 百分比计分配置才按部分分题拒绝。

整个 Polygon 导入批次先完成解析校验，再通过数据库事务保存。
数据库或文件写入失败时回滚，并清理本次新建的文件目录；不会覆盖已有题目。

## 验证与格式来源

运行 `npm run test:polygon-import`、`npm run test:judge-runtime`、`npm run test:communication`。
测试覆盖单题/多题/比赛包、题面转换、图片、样例、checker/interactor、两轮输出传递与最终判定、
非法数据、权限、旧格式兼容、比赛包仅新增题目而不创建比赛或关联，以及数据库和文件写入失败时的回滚。

运行 `npm run test:polygon:integration` 可使用 go-judge 编译并执行实际 C++ 测试题，
检查四种执行流程、最终 checker 拒绝、交互拒绝及轮次文件隔离，不访问数据库。
设置 `POLYGON_TEST_CXX` 为本地 C++ 编译器路径时可进行本机进程通信冒烟测试；
该模式不验证 go-judge 沙箱和资源限制，不能替代 go-judge 集成测试。

实现参考以下一手资料及公开包：

- [Codeforces 官方 Polygon API 文档](https://codeforces.github.io/polygon-misc/API)：
  `problem.package` 的 Linux、Windows、standard 区别，以及 problem/contest 描述符。
- [Polygon 官方 checker 与 validator 格式说明](https://codeforces.com/blog/entry/7979?locale=en)。
- [KPSC 公开 Polygon 比赛包](https://github.com/KMUCS-KPSC/KPSC-Archive/tree/main/contests/contest-35823)：
  实际的 `contest.xml`、`problem.xml`、HTML 题面和 `problem-properties.json`。
- [rbx Polygon XML 模型](https://github.com/rsalesc/rbx/blob/main/rbx/box/packaging/polygon/xml_schema.py)：
  相对 `path` 形式的比赛包结构。
- [Run-twice problems with Polygon and testlib.h](https://codeforces.com/blog/entry/142052?locale=en&mobile=true)：
  题目作者撰写的协议说明，包含首轮/第二轮交互、tout 传递与最终 checker。
- [Polygon package importer 的 XML 解析](https://github.com/rlatjwls7882/polygon-package-importer/blob/8467cc7fd08bf518cb020a2cd68dab055d39a62c/src/package/judging.js)：
  `run-count` 与 `interactor/runs/run` 的对应关系；官方 API 的对应字段为 `runTwice`、`interactiveSecondRun`。
