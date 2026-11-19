# NovaJudge

[![CI](https://github.com/CWNU-Open-Source-Community/NovaJudge/actions/workflows/ci.yml/badge.svg)](https://github.com/CWNU-Open-Source-Community/NovaJudge/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

[English](./README.md) · 简体中文

NovaJudge 是面向 ICPC / CCPC 风格程序设计竞赛和日常训练的开源在线评测平台，可以部署在学校、社团或赛事自己的服务器上。

[参赛者指南](#参赛者指南) · [管理员指南](#管理员指南) · [本地快速开始](#快速开始) · [详细文档](#详细文档)

## 功能

- **比赛与训练**支持公开赛、密码保护的私有赛、ACM 榜单与封榜、队伍答疑与公告，以及训练题单、赛后补题和虚拟参赛。
- **题库与评测**支持手动建题和 Polygon / NovaJudge ZIP 导入。题型包括普通题、自定义答案判定（Special Judge）、交互题和两轮通信题。go-judge 沙箱评测 C、C++、Java 和 PyPy3，多个判题进程（Worker）可以共享判题队列。
- **赛务与集成**提供队伍与工作人员批量导入、判题监控与重判、奖项配置、气球任务和打印队列。赛事可导出 ICPC Tools Resolver 使用的 Event Feed，也可接入 ICPC CCS、外部认证和监考客户端。

## 参赛者指南

### 参加一场比赛

1. **打开比赛。** 从站点首页选比赛，也可以打开主办方发给你的比赛链接。私有赛会先要求输入**比赛密码**，通过后才能浏览题目和榜单。
2. **登录队伍账号。** 在比赛主页的 **Sign In** 中输入主办方发给你的队伍用户名和密码。比赛密码用于解锁页面，队伍密码用于登录。采用监考客户端的比赛按主办方要求从客户端登录。如果已经登录全局账号，可以先退出，再登录队伍账号。
3. **阅读题目和提交。** 开赛后打开 **题目列表**，选题并阅读输入、输出、样例和限制。点题面上的 **提交**，选语言、粘贴源码并提交。
4. **查看结果。** 在 **提交状态** 查看判题结果。`AC` 表示通过，`WA` 表示答案错误，`CE` 表示编译错误，`TLE` 表示超时。在 **排行榜** 看排名，在 **答疑/公告** 看比赛通知或向裁判提问。

### 训练、补题与内网命令行

- 站点启用外部认证时，可从首页的 **外部登录** 进入全局账号，然后打开 **训练中心**。赛后可用外部账号进入旧比赛补题。比赛主页显示 **虚拟参赛** 时，可以开始一场按个人时间计时的重赛。主办方发布题解后，可以从比赛导航打开 **题解**。
- 队伍如需在现场赛打印代码，可在比赛导航选择 **打印**，上传源码并查看申请进度。
- 主办方启用内网命令行时，从站点的 `/cli` 安装 Windows 或 macOS 客户端，运行 `submit A.cpp` 并按提示绑定队伍。`printfile` 需要监考客户端签发的设备授权。[选手命令行指南](./docs/CONTESTANT_CLI.md)

## 管理员指南

### 登录管理后台

全站后台使用**超级管理员**账号。退出当前账号后，在首页顶部导航栏的空白处快速点击三次，打开 **Super Admin Access**。输入超级管理员账号和密码，登录后点 **后台管理**，或访问 `/admin`。后台默认显示中文，右上角的 **English** 可以切换语言。全新部署的初始账号来自 `.env` 中的 `SUPER_ADMIN_USERNAME` 和 `SUPER_ADMIN_PASSWORD`。

比赛工作人员用各自的比赛账号在比赛主页 **Sign In** 登录，在该场比赛的页面处理赛务。`ADMIN`、`JUDGE`、`BALLOON`、`PRINT`、`OBSERVER` 分别对应比赛管理员、裁判、气球、打印和观察员。

### 准备题目

- **手动建题。** 打开 **题库 → 创建题目**，填标题、时限（毫秒）、内存限制、判题类型、题面和样例。保存后从题库列表打开 **管理测试数据与配置**，一次上传整套测试文件，例如成对的 `1.in` 和 `1.out`。系统可按文件名识别测试点并生成 `problem.yml`，也可以在该页编辑判题配置。重新上传数据时，该批文件会替换当前测试文件。
- **导入题包。** 打开 **题库 → 导入**，选择 NovaJudge ZIP 或 Polygon ZIP。Polygon 包需包含生成好的测试输入、标准答案和 checker 源码，有交互轮次的题目还需 interactor 源码。Polygon 比赛包会把题目加入题库，之后可在本平台创建比赛并关联这些题目。更新已有题目时，题库列表里的 **更新题目** 可以用单题 ZIP 保留原题目 ID、比赛关联和历史提交。[Polygon 导入指南](./docs/POLYGON_IMPORT.md)
- **检查判题。** 从题库列表打开 **测试题目**，用标程运行 **调试全部样例**。发布前再用队伍账号提交标程，确认正式测试数据也能通过。

### 创建比赛并导入账号

1. 打开 **比赛管理 → 创建比赛**，填写名称、起止时间与介绍，选择公开赛或私有赛。私有赛必须设置比赛密码。可见性选项控制比赛是否出现在首页列表。
2. 在该比赛的 **题目** 中填题库的 **题库题目 ID**，再设比赛中显示的 **显示题号**，例如 `A`。现场赛可以同时设置题目的气球颜色。
3. 在该比赛的 **账号** 中选择 **队伍** 或 **工作人员与裁判**。从表格复制数据行，按下列顺序使用 Tab 分隔列，预览无误后点 **导入账号**。

   | 类型 | 列顺序 |
   | --- | --- |
   | Teams | Username → Password → TeamName → School → Members → Seat → Coach → Type → AutoLoginIP |
   | Staff & Judges | Username → Password → RealName → Role |

   Password 留空会自动生成。队伍的 Type 可填 `0`（正式）、`1`（打星）或 `2`（女生队）。通过 **导出 CSV** 导出比赛账号，分别发给对应队伍和工作人员。私有赛还需提供比赛链接和比赛密码。

### 跑通第一场练习赛

创建一道 `A+B` 普通题，题面要求读入一行两个整数并输出它们的和。添加样例输入 `2 3`、输出 `5`，并将相同内容分别保存到 `1.in` 和 `1.out`，一起上传到该题的测试数据页。

创建一场练习赛，把题目加为 `A`，导入一个测试队伍。比赛开始后，在浏览器隐身窗口用队伍账号登录，选择 **PyPy3** 并提交下面这行代码。在 **提交状态** 看到 `AC` 后，再到 **排行榜** 确认队伍的解题记录。

```python
print(sum(map(int, input().split())))
```

### 比赛期间与赛后

| 要做什么 | 在哪里操作 |
| --- | --- |
| 回答提问、发公告 | 比赛页 **答疑/公告**。比赛 `ADMIN` 和 `JUDGE` 在线时会收到待回复提醒。 |
| 检查评测队列和 Worker | 后台 **判题监控**。提交持续排队时，先检查 Worker 是否在线，再检查 Redis 和 go-judge。 |
| 重判提交 | 在比赛 **提交状态** 按题目、队伍或结果筛选并预览重判范围。全站批量重判在后台 **全站提交记录**。 |
| 解榜、导出成绩和奖项 | 在比赛 **排行榜** 解榜、导出成绩表或打开打印版榜单。在后台比赛的 **奖项** 设置奖项并导出供 Resolver 使用的 Event Feed。 |
| 发布题解 | 编辑比赛，在 **题解 PDF** 上传题解文件。 |
| 处理现场事务 | 在比赛页 **气球中心** 分配、完成配送任务，在 **打印队列** 处理队伍的打印请求。 |

后台 **训练中心** 用于编排训练目录，**系统设置** 用于管理站点设置。其中 **允许外部登录** 需要先配置外部认证接口。隔离内网可在 Web 环境配置 `NOVAJUDGE_CLI_MODE=intranet`，重启后在 **系统设置** 选择命令行使用的比赛。[部署配置](./docs/DEPLOYMENT.md)

## 快速开始

如果已有主办方提供的站点，直接看[参赛者指南](#参赛者指南)。本地部署推荐 **Node.js 22.12+（22.x）**，另需 npm 和支持 Linux 容器的 Docker Compose v2。以下命令以 Bash 为例。[其他支持的 Node.js 版本](./package.json)

```bash
git clone https://github.com/CWNU-Open-Source-Community/NovaJudge.git
cd NovaJudge
cp .env.example .env
```

编辑 `.env`，设置 `POSTGRES_PASSWORD` 和匹配的 `DATABASE_URL`。使用仓库的 Compose 时，连接串形如 `postgresql://postgres:YOUR_PASSWORD@localhost:5432/xcpc_oj?schema=public`，将占位内容替换为经过 URL 编码的实际密码。再设置独立的 `JWT_SECRET`、初始超级管理员用户名 `SUPER_ADMIN_USERNAME` 和密码 `SUPER_ADMIN_PASSWORD`。[完整环境变量模板](./.env.example)

```bash
npm ci --include=dev
docker compose up -d --build --wait
npm run db:deploy
npm run dev
```

在项目目录另开终端启动评测进程。

```bash
npm run worker
```

打开 [http://localhost:3001](http://localhost:3001)，按[管理员指南](#管理员指南)登录并跑通练习赛。Compose 提供 PostgreSQL、Redis 和 go-judge，Web 和 Worker 由上面的 npm 命令启动。

生产环境使用 `npm run build` 构建，再托管 `npm run start` 和 Worker 进程。部署已有数据库时，先备份 PostgreSQL、`uploads/` 和 `.env`，再按升级文档执行迁移。多台 Worker 可以用 `npm run worker:multi -- 4` 启动，也可以分机部署并共享题目数据。[生产部署与旧版升级](./docs/DEPLOYMENT.md)

## 详细文档

| 文档 | 内容 |
| --- | --- |
| [部署与维护交接](./docs/DEPLOYMENT.md) | 环境变量、外部认证、站点配置、迁移、备份与回滚 |
| [Polygon 题包导入](./docs/POLYGON_IMPORT.md) · [两轮通信题](./docs/COMMUNICATION_PROBLEMS.md) | 题包格式、支持的题型和判题配置 |
| [选手 CLI](./docs/CONTESTANT_CLI.md) · [监考客户端](./docs/PROCTORING_LOGIN.md) | 内网安装、绑定、提交和打印 |
| [API 与 ICPC CCS](./docs/API_DOCS.md) | API Key、赛事数据和外部集成 |
| [C++23 工具链](./docs/CPP23_COMPILER_FIX.md) · [Windows 联调](./docs/WINDOWS_FULL_E2E.md) | 沙箱编译环境与现场赛联调 |
| [更新日志](./docs/CHANGELOG.md) | 版本变更 |

## 参与贡献

项目使用 Next.js、React 和 TypeScript。Web 页面和 API 位于 `app/`，判题逻辑位于 `lib/judge.ts` 和 `lib/judge/`，判题进程入口为 `worker.ts`，数据库模型和迁移位于 `prisma/`。

欢迎通过 [Issues](https://github.com/CWNU-Open-Source-Community/NovaJudge/issues) 反馈问题。请附上版本、复现步骤和脱敏后的日志。提交 Pull Request 前，运行以下检查。

```bash
npm test
npm run lint
npm run build
```

## 开源协议

NovaJudge 使用 [MIT 许可证](./LICENSE)。
