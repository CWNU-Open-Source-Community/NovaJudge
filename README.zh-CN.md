# NovaJudge

**轻量、现代的新一代 XCPC 在线评测与赛事运营平台**

[![CI](https://github.com/CWNU-Open-Source-Community/NovaJudge/actions/workflows/ci.yml/badge.svg)](https://github.com/CWNU-Open-Source-Community/NovaJudge/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16.4-black)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-149eca)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-7-2d3748)](https://www.prisma.io/)
[![go-judge](https://img.shields.io/badge/Sandbox-go--judge-00add8)](https://github.com/criyle/go-judge)

[简体中文](./README.zh-CN.md) · [English](./README.md)

NovaJudge 是专为 **ICPC / CCPC（XCPC）现场赛、线上赛与日常集训**打造的一体化在线评测（Online Judge）平台。它不仅提供高精度沙箱评测，还将完整的赛事运营工作流集中在单个 Next.js 应用内：题库管理与 Polygon 题包导入、队伍/工作人员权限体系、多实例并发实时判题、支持封榜与滚榜（Resolver）奖项导出的 ACM 排行榜、带实时弹窗提醒的答疑系统、现场赛气球配送与代码打印队列、内网选手命令行（`submit` / `printfile`）、监考客户端专用绑定登录、可选外部统一身份认证，以及兼容 ICPC CCS 的外部数据接口。

---

## 目录

- [系统架构](#系统架构)
- [核心特性](#核心特性)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [环境变量说明](#环境变量说明)
- [多开判题机与评测调度](#多开判题机与评测调度)
- [重点工作流与安全机制](#重点工作流与安全机制)
- [常用脚本与测试套件](#常用脚本与测试套件)
- [文档导航](#文档导航)
- [项目结构](#项目结构)
- [开源协议](#开源协议)

---

## 系统架构

```mermaid
flowchart LR
    subgraph Clients["客户端与外部集成"]
        Web["选手 / 裁判 / 管理员浏览器"]
        CLI["内网选手命令行 (submit / printfile)"]
        Proctor["监考桌面客户端"]
        CCS["ICPC Tools 滚榜 / 外榜 / API 集成"]
    end

    subgraph App["NovaJudge Web 服务 (Next.js 16)"]
        Pages["App Router 页面与 Server Actions"]
        API["REST / SSE / CCS 接口"]
    end

    subgraph Infra["存储与协调队列"]
        PG[("PostgreSQL 16\n(Prisma 7)")]
        Redis[("Redis 7\n(BullMQ 队列 + 心跳 + 分布式租约)")]
        FS[("uploads/\n(测试数据 + .judge-cache 编译缓存)")]
    end

    subgraph Judging["评测集群"]
        Workers["Judge Workers (1..N)"]
        Sandbox["go-judge 安全沙箱\n(GCC 15.2 / OpenJDK 21 / PyPy3)"]
    end

    Clients --> App
    Pages --> PG
    API --> PG
    Pages --> Redis
    API --> Redis
    App --> FS
    Redis <--> Workers
    Workers --> PG
    Workers <--> FS
    Workers --> Sandbox
```

---

## 核心特性

### 赛事全流程运营与现场赛支持
- **比赛全生命周期管理**：支持公开赛与密码保护私有赛，由 Worker 唯一调度器自动完成 `PENDING → RUNNING → ENDED` 状态流转。
- **队伍、工作人员与外部账号体系**：支持 TSV 批量导入账号、多角色权限隔离（`TEAM`、`ADMIN`、`JUDGE`、`BALLOON`、`PRINT`、`OBSERVER`）、学校/教练/队员/座位号/打星分组管理、现场赛**座位 IP 自动登录**，以及可选的**外部统一账号密码登录**与账号封禁管理（`/admin/accounts`）。
- **ACM/ICPC 排行榜与奖项滚榜**：实时解题榜单，支持**封榜（Freeze）与解榜（Unfreeze）**、虚拟参赛同榜切换、PDF/CSV 导出，内置**奖项配置工作台**（按比例或固定数量设置金/银/铜牌、最快解题奖 First-to-Solve、按学校去重的冠/亚/季军、优秀奖及自定义奖项），一键导出兼容 **ICPC Tools Resolver** 的事件流。
- **答疑公告与工作人员实时提醒**：支持队伍私有提问与全站公告；比赛 `ADMIN` 与 `JUDGE` 账号在网页保持登录时自动接收新提问与追问的站内弹窗提醒及顶部铃铛待处理计数。
- **气球配送与打印队列**：队伍首通某题自动去重生成气球任务并支持指派配送员；内置代码打印申请队列与工作人员打印面板。
- **训练中心、赛后补题与虚拟参赛（VP）**：支持树状目录编排训练题单，登录全局账号即可进行赛后补题与任意历史比赛的虚拟参赛。
- **公网/校内同源统一部署**：公网、校内机房及其他高校共用同一套主分支代码，通过部署环境变量配置站点名称、学校页脚与外部组织映射，无需维护学校私有分支。

### 题库管理与高精度评测引擎
- **丰富题型支持**：原生支持**传统题（`default`）**、**Special Judge（`spj`）**、**交互题（`interactive`）**与**两轮运行通信题（`communication`）**，提供分章节 Markdown + KaTeX 题面编辑器、成对通信样例展示与后台在线样例调试。
- **现代编译工具链镜像**：仓库内置定制沙箱 `Dockerfile`，预装 **C11** 与 **C++23**（固定 **GCC 15.2**，`-O2 -static`）、**Java 21**（OpenJDK 21，兼容 amd64 / Apple Silicon arm64）和 **Python 3**（PyPy3）。
- **Polygon 题包导入与单题热更新**：支持直接导入 **Codeforces Polygon** 导出的单题、多题或整场比赛 ZIP（自动转换 HTML 题面、公式与图片资源，保留 `testlib.h` checker/interactor，完整支持单轮交互及首轮/双轮交互通信协议），同时保留原生 NovaJudge ZIP 备份导入与**单道题目 ZIP 原地热更新**。
- **裁判程序磁盘编译缓存**：`checker`、`interactor`、`communicator` 首次编译后持久化至 `uploads/problems/<题目 ID>/.judge-cache/`，通过 Redis 租约协调多进程并发编译，源码、`testlib.h` 或编译参数变更时自动增量重编。
- **精确 CPU 时限与实际耗时看门狗**：选手 `TLE` 严格依据沙箱实测 CPU 时间判定，不受宿主机调度或 I/O 等待干扰；同时配备独立实际耗时看门狗（`max(JUDGE_WALL_WATCHDOG_MS, 20 × CPU 时限)`），进程卡死但未超 CPU 时限时记为 `SYSTEM_ERROR` 并附带诊断信息，避免误扣选手罚时。
- **安全分级重判**：支持比赛内多维筛选重判（按队名、账号、学校、座位、Run ID、题目、结果、语言、时间段）及全局后台批量条件重测（单批上限 5000 条，带预览确认与实时进度）。

### 监考集成、内网选手 CLI 与开放接口
- **监考专用绑定登录**：对接桌面监考客户端（`loginSource: "PROCTORING"`）；一旦建立监考绑定，该比赛账号仅限携带专用凭据的监考客户端访问，阻断普通浏览器密码登录、Cookie 复制与 IP 自动登录。
- **零依赖内网选手命令行**：面向内网现场赛提供原生 **Windows**（PowerShell 5.1）与 **macOS**（Bash/curl）的 `submit` 提交与 `printfile` 打印命令，选手机无需安装 Node.js、Python 或管理员权限。
- **ICPC CCS 与开放平台 API**：提供 `x-api-key` 认证与兼容 ICPC CCS 规范的数据接口（`/api/ccs/contests/:id/...`），无缝对接滚榜工具、外榜与直播大屏。

---

## 技术栈

| 层级 | 技术选型 |
| :--- | :--- |
| **前端与服务端** | Next.js 16 (App Router)、React 19、TypeScript 5、Tailwind CSS 4、Headless UI、Framer Motion、Monaco Editor、KaTeX |
| **数据库与 ORM** | PostgreSQL 16、Prisma 7 (`@prisma/adapter-pg`) |
| **队列与分布式协调** | Redis 7、BullMQ 5（原子任务锁、Worker 心跳注册、状态调度与编译缓存租约） |
| **评测沙箱** | [go-judge](https://github.com/criyle/go-judge) (`v1.11.2`)、Ubuntu 24.04、GCC/G++ 15.2、OpenJDK 21、PyPy3、`testlib.h` |
| **基础设施与 CI** | Docker & Docker Compose、GitHub Actions |

---

## 快速开始

### 环境要求
- **Node.js** `22 LTS`（支持 `^20.19.0 || ^22.12.0 || >=24.0.0`）与 **npm**
- **Docker** 与 **Docker Compose**（用于运行 PostgreSQL 16、Redis 7 以及特权模式的 `go-judge` 容器）

### 全新安装

安装依赖（`npm ci` / `npm install`）仅生成 Prisma Client 并复制 Monaco 编辑器静态资源，**不会连接或修改业务数据库**；数据库初始化与迁移统一通过 `npm run db:deploy` 显式执行。

```bash
git clone https://github.com/CWNU-Open-Source-Community/NovaJudge.git
cd NovaJudge
cp .env.example .env
# 编辑 .env：填写 POSTGRES_PASSWORD、与之匹配的 DATABASE_URL、
# 独立的 JWT_SECRET、SUPER_ADMIN_USERNAME 和 SUPER_ADMIN_PASSWORD。

npm ci
docker compose up -d --build --wait
npm run db:deploy
npm run dev
```

另开一个终端启动判题 Worker：

```bash
npm run worker
```

浏览器访问 `http://localhost:3001` 即可使用（管理后台入口：`http://localhost:3001/admin`）。

### 生产运行与旧版本平滑升级

生产环境建议使用进程管理器分别守护 `npm run build && npm run start` 与 `npm run worker:multi -- 2`。

> **从旧公开版或旧校内私服升级？** 请务必先阅读 [统一版本部署与维护交接指南](./docs/DEPLOYMENT.md)，了解数据库与 `uploads/` 备份、旧库结构自动识别与无损迁移（`npm run db:deploy`）、回滚预案、外部登录配置及学校页脚/组织映射设置。

---

## 环境变量说明

| 变量名 | 默认值 / 示例 | 说明 |
| :--- | :--- | :--- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `postgres` / *(必填)* / `xcpc_oj` | `docker-compose.yml` 中本地 PostgreSQL 容器初始化凭据 |
| `DATABASE_URL` | `postgresql://postgres:...@localhost:5432/xcpc_oj?schema=public` | PostgreSQL 连接串（使用 Compose 时密码需与 `POSTGRES_PASSWORD` 一致） |
| `REDIS_URL` | `redis://localhost:6379` | Redis 连接串（用于评测队列、心跳与分布式租约） |
| `GO_JUDGE_API` | `http://localhost:5050` | `go-judge` 判题沙箱 HTTP 接口地址 |
| `GO_JUDGE_REQUEST_TIMEOUT_MS` | *(自动计算)* | 可选 `go-judge` HTTP 请求超时（毫秒，默认自动覆盖看门狗时长） |
| `PROBLEM_DATA_ROOT` | `uploads/problems` | 多主机 Worker 共享题目数据根目录（内容对应 Web 的 `uploads/problems`） |
| `JWT_SECRET` | *(必填)* | 登录会话与私有赛访问令牌签名密钥 |
| `SUPER_ADMIN_USERNAME` / `SUPER_ADMIN_PASSWORD` | *(必填)* | 初始超级管理员用户名与密码 |
| `NOVAJUDGE_URL` | `http://localhost:3001` | 选手可访问的站点地址（供 CLI 自动绑定与链接生成使用） |
| `NOVAJUDGE_CLI_MODE` | `public` | 公网部署保持 `public`（关闭 CLI）；仅在隔离内网环境设为 `intranet` 后启用 `/cli`、`submit` 与 `printfile` |
| `EXTERNAL_AUTH_URL` / `APP_KEY` | *(空)* | 可选外部统一认证接口与服务端密钥（新安装默认关闭，旧私服保留原开关状态） |
| `NOVAJUDGE_SITE_NAME` / `NOVAJUDGE_SITE_DESCRIPTION` | `NovaJudge` / `XCPC Online Judge` | 站点导航栏/标题名称与页面描述（修改后重新 build 并重启 Web） |
| `NOVAJUDGE_FOOTER_TEXT` | *(空)* | 可选的学校或组织页脚说明文字 |
| `NOVAJUDGE_ORG_MAP_PATH` | `config/org-map.json` | 可选外部组织映射 JSON 路径（如 `/etc/novajudge/org-map.json`） |
| `JUDGE_CONCURRENCY` | `4` | 单台 Worker 进程同时评测的提交并发数 |
| `JUDGE_ID` | *(自动分配)* | 指定当前判题机 ID |
| `JUDGE_WORKER_COUNT` / `JUDGE_WORKER_IDS` | `2` / *(未设置)* | `npm run worker:multi` 启动的判题机数量或显式 ID 列表（如 `1,2,3`） |
| `JUDGE_WALL_WATCHDOG_MS` | `60000` | 单次运行最小实际经过时间兜底阈值（毫秒），最终取 `max(此值, 20 × CPU 时限)` |

---

## 多开判题机与评测调度

### 启动多台判题机

所有 Worker 共享同一个基于 Redis 的 BullMQ 队列（`judge-queue`），系统总并发判题能力为 `在线判题机数 × JUDGE_CONCURRENCY`。

```bash
# 启动单台判题机（自动分配 ID）
npm run worker

# 指定显式 ID 启动
npm run worker -- --id 1

# 一键启动 4 台判题机（自动分配全局 ID）
npm run worker:multi -- 4

# 或通过环境变量控制多开数量与 ID
JUDGE_WORKER_COUNT=4 npm run worker:multi
JUDGE_WORKER_IDS=1,2,3 npm run worker:multi
```

### 多实例防冲突机制
- **原子领取**：BullMQ 在 Redis 中对每个任务加锁领取，任意时刻同一份提交只会被唯一一台 Worker 执行。
- **幂等入队**：所有提交通道与重判入口统一经过 `lib/queue.ts` 的 `enqueueJudge()`，每份提交绑定固定 `jobId`，重复点击或并发重判不会产生重复任务。
- **唯一状态调度器**：比赛状态自动推进（`PENDING → RUNNING → ENDED`）通过 Redis 租约在多台 Worker 中选出唯一 Leader 执行。

### 裁判程序编译缓存
`checker`、`interactor` 与 `communicator` 的编译产物保存在 `uploads/problems/<题目 ID>/.judge-cache/`（或 `<PROBLEM_DATA_ROOT>/<题目 ID>/.judge-cache/`）。共享该目录且连接同一 `GO_JUDGE_API` 的进程在 Web、Worker 与 `go-judge` 重启后仍可直接复用二进制缓存。每次运行前自动校验源码路径、源码内容、`testlib.h` 与编译参数，多进程并发缺失时通过 Redis 租约只编译一次；每份提交从缓存加载独立沙箱临时可执行文件并在判题后清理。*（升级编译器或沙箱镜像后，删除对应 `.judge-cache` 目录即可强制重编。）*

### CPU 时限与看门狗兜底
选手程序 `TLE` 严格依据实测 CPU 时间判定，系统调度和 I/O 等待不计入选手 CPU 预算。每次运行另有 `max(JUDGE_WALL_WATCHDOG_MS, 20 × CPU 时限)` 的实际经过时间兜底：若看门狗超时但实测 CPU 未超限，系统将其记为 `SYSTEM_ERROR` 并记录耗时诊断，不会误判选手罚时。

### 在线监控与压力测试
- **实时监控面板**：在 **Admin → Dashboard → Judge Workers** 查看所有在线 Worker 心跳与队列统计（每 5 秒自动刷新，离线 15 秒自动移除），或在 **`/admin/judge-monitor`**（原 `/admin/monitor` 自动跳转至此）查看近 60 分钟每分钟提交曲线、队列深度与结果分布。
- **队列吞吐压测**：使用 `stress-test.ts` 批量压入提交并统计各 Worker 吞吐表现：
  ```bash
  npm run stress -- --total=100 --batch=20 --lang=cpp
  ```
  支持参数：`--total`（总数）、`--batch`（每批并发）、`--lang`（`c` | `cpp` | `java` | `pypy3`）、`--problem`（题目 ID）、`--no-wait`、`--timeout`、`--mark`。

---

## 重点工作流与安全机制

### Polygon 题包导入与单题压缩包热更新
- **Polygon 导入**：在后台 **Import Problems / Import Contests** 选择 **Polygon** 格式，支持导入单题、多题或包含 `contest.xml` 的比赛导出包（涵盖普通题、交互题及单轮/双轮交互通信题）。比赛包导入仅批量新增题库题目，不会自动创建或改动现有比赛，便于管理员按需创建比赛并勾选题目。详见 [docs/POLYGON_IMPORT.md](./docs/POLYGON_IMPORT.md)。
- **单题原地更新**：在后台题库列表点击目标题目的 **Update Problem**（上传图标），上传仅含一道题目的导出 ZIP，即可在保留原题目 ID、比赛关联与历史提交记录的前提下替换题面、样例、限制、YAML 配置、测试数据与附件，并自动清理过期旧文件。

### 私有赛密码访问控制
私有赛强制要求配置比赛密码。除超级管理员外，所有访问者（含已登录的比赛账号与全局账号，在赛中及赛后均生效）必须先验证比赛密码，才能查看比赛介绍、题目、榜单、提交、公告、题解与私有附件。浏览器验证凭证有效期 24 小时（退出登录或管理员修改比赛密码立即失效），仅解锁浏览权限而不授予额外提交或管理权限。CLI 访问私有赛需携带 `x-contest-access-token`；CCS Basic 认证仅限超级管理员使用。

### 内网选手命令行与监考专用登录
- **服务端内网开关**：选手命令行默认关闭（`NOVAJUDGE_CLI_MODE=public`）。仅在隔离内网环境显式设置 `NOVAJUDGE_CLI_MODE=intranet` 并重启 Web 服务，再由管理员于 **System Settings** 指定当前 CLI 比赛后方可启用。
- **普通网页配对（`submit`）**：选手访问 `/cli` 一键安装全局 `submit` 命令，运行 `submit A.cpp`（或 `submit -y --problem A main.cpp`）首次自动唤起浏览器完成队伍绑定。
- **监考自动绑定（`submit` 与 `printfile`）**：通过监考桌面客户端登录后，比赛账号与该客户端专用凭据（`x-novajudge-proctor-key`）强绑定，并自动签发支持 `submit` 与 `printfile [-y] A.cpp`（支持 `.c`、`.cpp`、`.cc`、`.cxx`、`.java`、`.py`）的受管设备授权；普通网页配对不可调用 `printfile`。详见 [docs/CONTESTANT_CLI.md](./docs/CONTESTANT_CLI.md) 与 [docs/PROCTORING_LOGIN.md](./docs/PROCTORING_LOGIN.md)。

### 比赛提问站内提醒
比赛 STAFF 中的 `ADMIN` 与 `JUDGE` 保持页面打开时每 10 秒轮询待回复提问，新提问与选手追问会触发浏览器去重弹窗及导航栏铃铛计数，任一裁判/管理员回复后自动消警。相关数据库索引由 `npm run db:deploy` 自动部署。

---

## 常用脚本与测试套件

### 开发、构建、数据库与判题机脚本

```bash
npm run dev            # 启动开发服务器（端口 3001）
npm run build          # 构建生产版本
npm run start          # 启动生产 Web 服务器（端口 3001）
npm run lint           # 运行 ESLint 代码检查
npm run prisma         # 重新生成 Prisma Client
npm run db:deploy      # 部署数据库迁移（支持全新空库及旧版公网/私服库无损纳管）
npm run db:status      # 查看 Prisma 迁移状态
npm run upgrade        # Linux 生产环境升级辅助脚本（环境检查 + 迁移 + 构建）
npm run worker         # 启动单台判题机（自动分配 ID）
npm run worker:multi   # 多开判题机，例如 "npm run worker:multi -- 4"
npm run worker:dev     # 以 watch 热重载模式启动判题机
npm run stress         # 批量压入提交进行判题吞吐压测
```

### 单元测试与集成验收套件

```bash
# 一键运行全部应用单元与 CLI 回归测试
npm test

# 按模块运行单元与权限回归测试（无需外部数据库或沙箱服务）
npm run test:polygon-import
npm run test:problem-update
npm run test:communication
npm run test:judge-runtime
npm run test:judge-cache
npm run test:contest-access
npm run test:rejudge
npm run test:clarification-notifications
npm run test:proctoring
npm run test:cli-device
npm run test:submit-macos
npm run test:submit-windows
npm run test:submit-legacy

# 真实环境集成测试（需本地运行对应的 PostgreSQL / Redis / go-judge / Web 服务）
npm run test:database-upgrade
npm run test:judge-runtime:integration
npm run test:judge-cache:integration
npm run test:polygon:integration
npm run test:communication:integration
npm run test:problem-update:integration
npm run test:clarification-notifications:integration
npm run test:proctoring:integration
npm run test:submit-macos:integration
npm run test:submit-windows:integration
```

---

## 文档导航

| 文档 | 内容说明 |
| :--- | :--- |
| [统一版本部署与维护交接](./docs/DEPLOYMENT.md) | 全新部署、旧公开版/私服无损升级、外部登录、站点品牌配置、备份与回滚指南 |
| [API 与 CCS 接口文档](./docs/API_DOCS.md) | 平台 REST 接口说明、`x-api-key` 认证及 ICPC CCS 兼容数据流 |
| [Polygon 题包导入说明](./docs/POLYGON_IMPORT.md) | Polygon 单题/多题/比赛包导入规范、题面转换与双轮交互通信协议 |
| [两轮通信题配置指南](./docs/COMMUNICATION_PROBLEMS.md) | 原生 `communication` 题型配置、`communicator.cpp` 接口与[字母信使示例题包](./examples/communication/encode-decode/README.md) |
| [选手命令行安装与使用](./docs/CONTESTANT_CLI.md) | Windows（PowerShell 5.1 / Win7 准备）与 macOS 下 `submit` / `printfile` 使用指南 |
| [监考专用登录协议](./docs/PROCTORING_LOGIN.md) | 监考客户端会话独占绑定、内网 CLI 离线安装与设备令牌生命周期 |
| [C++23 编译工具链说明](./docs/CPP23_COMPILER_FIX.md) | GCC 15.2 沙箱镜像构建方案、`constexpr` 内存回归测试与平滑升级流程 |
| [Windows 全流程联调手册](./docs/WINDOWS_FULL_E2E.md) | NovaJudge + 监考桌面端 + WebRTC 媒体服务单机与局域网全流程验收指南 |
| [更新日志 (Changelog)](./docs/CHANGELOG.md) | 版本演进记录与新增功能说明 |

---

## 项目结构

```text
NovaJudge/
├─ .github/workflows/    # GitHub Actions CI（数据库升级测试、Lint、单元/集成回归与生产构建）
├─ app/                  # Next.js App Router 页面、Server Actions 与 REST/CCS API 路由
├─ components/           # 比赛前台、Monaco 代码编辑器、Markdown/KaTeX 渲染及管理后台组件
├─ config/               # 默认学校/组织 ID 映射配置（用于 CCS 与滚榜导出）
├─ context/              # 前端全局状态 Context Providers
├─ docs/                 # 部署交接、专题功能文档、API 手册与运维联调指南
├─ examples/             # 示例题目包（如两轮通信题完整示例）
├─ lib/                  # 认证鉴权、判题引擎、Polygon 解析器、BullMQ 队列、Redis、Prisma 与 CCS 模块
├─ prisma/               # Prisma 数据模型 Schema、统一基线迁移与旧库识别快照
├─ public/               # 静态资源（Monaco Editor 资源在 postinstall 阶段自动同步至此）
├─ scripts/              # 数据库无损升级、多判题机启动器、CLI 辅助工具与集成测试脚本
├─ tests/                # 编译器与 Polygon 导入测试样例固件
├─ tools/contestant-cli/ # Windows PowerShell 与 macOS 原生选手 CLI 安装器与脚本
├─ uploads/              # 题目测试数据、题面图片附件与 .judge-cache 编译产物缓存
├─ worker.ts             # BullMQ 判题机主程序（支持多实例、Redis 心跳上报与比赛状态调度）
├─ stress-test.ts        # 多判题机队列并发吞吐压测工具
├─ Dockerfile            # 定制 go-judge 判题镜像（Ubuntu 24.04 + GCC 15.2 + OpenJDK 21 + PyPy3）
└─ docker-compose.yml    # 本地 PostgreSQL 16、Redis 7 与 go-judge 编排配置
```

---

## 开源协议

NovaJudge 基于 [MIT 协议](./LICENSE) 开源。
