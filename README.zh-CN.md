# NovaJudge

与监考系统集成时可启用[监考专用登录](docs/PROCTORING_LOGIN.md)：监考登录后，该比赛账号只能通过携带专用凭据的监考客户端访问。

[简体中文](./README.zh-CN.md) · [English](./README.md)

NovaJudge 是一个轻量级在线评测（Online Judge）平台，面向 XCPC 风格训练与现场赛。
它不只支持独立提交，更聚焦于比赛运营：题目管理、队伍账号、实时判题、排行榜、
答疑（Clarification）、气球配送、打印队列、API Key 以及兼容 ICPC CCS 的数据接口，
全部集成在一个 Next.js 应用中。

## 功能特性

- 公开赛 / 私有赛的完整生命周期管理。
- 队伍账号批量导入、登录、角色、座位、队员、学校、教练与分组。
- 题库支持 Markdown/LaTeX 题面、样例、资源文件、测试数据与 YAML 判题配置。
- 基于 Redis、BullMQ、Worker 进程和 [go-judge](https://github.com/criyle/go-judge)
  的实时提交评测。
- checker、interactor 和 communicator 首次使用时编译，后续提交和样例调试复用编译结果；
  更换源码、修改 `testlib.h` 或编译参数后自动重新编译。
- 支持两轮普通输入输出的通信题：独立运行同一程序两次，通过通信裁判校验和转换消息。
  参见[通信题配置与示例](./docs/COMMUNICATION_PROBLEMS.md)。
- 支持多开判题机：每台判题机拥有唯一 ID，后台首页实时展示状态，
  多台判题机从共享队列领取任务互不冲突。
- ACM/ICPC 风格排行榜，支持封榜（freeze）与解封（unfreeze）。
- 面向选手与裁判的答疑、通知系统。
- 现场赛的气球配送与打印队列工作流。
- API Key 认证与 ICPC CCS 兼容接口，方便对接外部工具。
- 面向登录用户的训练中心与虚拟参赛（VP）支持。

## 技术栈

- Next.js 16、React 19、TypeScript
- Tailwind CSS、Heroicons、Sonner、Monaco Editor
- PostgreSQL、Prisma 7
- Redis、BullMQ
- go-judge
- Docker Compose（本地基础设施）

## 快速开始

克隆仓库并安装依赖：

```bash
git clone https://github.com/pppolf/NovaJudge.git
cd NovaJudge
npm install
```

创建环境变量文件：

```bash
cp .env.example .env
```

常用环境变量：

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/xcpc_oj?schema=public"
REDIS_URL="redis://localhost:6379"
GO_JUDGE_API="http://localhost:5050"
JWT_SECRET="please-change-this-secret"
SUPER_ADMIN_USERNAME="admin"
SUPER_ADMIN_PASSWORD="123456"
JUDGE_CONCURRENCY=4
NOVAJUDGE_URL="http://localhost:3001"
```

启动 PostgreSQL、Redis 和 go-judge：

```bash
docker-compose up -d
```

初始化 Prisma 并启动 Web 服务：

```bash
npx prisma db push
npm run prisma
npm run dev
```

在另一个终端启动判题机：

```bash
npm run worker
```

开发服务器默认运行在 `http://localhost:3001`。

## 多开判题机

所有判题机共享同一个基于 Redis 的 BullMQ 队列（`judge-queue`）。
BullMQ 通过 Redis 原子操作领取任务，因此无论同时运行多少台判题机，
同一份提交只会被其中一台判题机领取并评测 —— 它们之间绝不会冲突。

```bash
# 启动单台判题机（ID 自动分配，例如 MacBook-1）
npm run worker

# 指定 ID 启动
npm run worker -- --id 1
npm run worker -- --id 2

# 一键多开：启动 4 台判题机，ID 依次为 1-4
npm run worker:multi -- 4

# 或通过环境变量控制
JUDGE_WORKER_COUNT=4 npm run worker:multi
JUDGE_WORKER_IDS=1,2,3 npm run worker:multi
```

相关环境变量：

```env
JUDGE_CONCURRENCY=4   # 每台判题机同时判几题（总并发 = 判题机数 x 该值）
JUDGE_ID=1            # 判题机 ID（可选，未设置时自动分配）
JUDGE_WORKER_COUNT=4  # npm run worker:multi 多开数量
JUDGE_WORKER_IDS=1,2  # npm run worker:multi 指定 ID 列表
```

### 多开如何避免任务冲突

- **原子领取** —— BullMQ 在 Redis 中为每个任务加锁领取，同一时刻两台判题机
  不可能拿到同一个任务。
- **幂等入队** —— 所有入队路径都经由 `lib/queue.ts` 中的 `enqueueJudge()`，
  每份提交使用固定 jobId：重复点击、并发重判都只会产生一个队列任务，
  正在被评测的提交也不会重复入队。
- **单一调度器** —— 比赛状态调度（`PENDING → RUNNING → ENDED`）通过 Redis
  租约在多台判题机中选出唯一的 leader 执行，不会重复运行。

### 裁判程序编译缓存

checker、interactor 和 communicator 的编译结果保存在
`uploads/problems/<题目 ID>/.judge-cache/`，共享该目录且使用相同 go-judge 地址的进程复用缓存。
首次判题或样例调试时编译，之后按源码路径、源码内容、`testlib.h` 和编译参数校验，
仅在这些输入变化或缓存损坏、丢失时重新编译。在线编辑、上传覆盖或更换 YAML 中的文件引用均会自动生效。
多个进程同时遇到缓存缺失时通过 Redis 租约协调编译。

每份提交从缓存恢复独立的 go-judge 临时文件，判题结束后照常清理；更新文件不会影响已开始判题的提交，
Web、Worker 和 go-judge 重启后仍可使用磁盘上的编译结果。缓存目录位于测试数据目录之外，
不会被测试数据上传替换，也不会包含在题目数据导出中。升级编译器或判题容器环境后，可删除对应缓存目录以强制重新编译。

运行 `npm run test:judge-cache` 验证缓存行为；已有 Redis 和 go-judge 服务时，
运行 `npm run test:judge-cache:integration` 验证真实编译和多进程复用（不访问数据库）。

### 压力测试

`stress-test.ts` 可以批量向判题队列压入提交，统计多台判题机协同判题的吞吐：

```bash
npm run stress -- --total=100 --batch=20 --lang=cpp
```

参数说明：`--total` 提交总数、`--batch` 每批并发数、`--lang` 语言
（`c` | `cpp` | `java` | `pypy3`）、`--problem` 题目 ID、
`--no-wait` 只入队不等待结果、`--timeout` 等待判题完成的秒数、
`--mark` 标记（以注释形式写入每份提交的代码，便于事后定位）。
脚本会输出入队吞吐、判题结果分布、判题总耗时以及每台判题机本次处理的数量。

### 在后台首页监控判题机

每台判题机都会向 Redis 上报心跳（ID、主机名、PID、并发数、已判数量、
正在评测的提交）。后台首页（**Admin → Dashboard → Judge Workers**）会列出
所有在线的判题机及其 ID，并展示队列统计（等待 / 评测中 / 已完成 / 失败），
每 5 秒自动刷新。判题机停止后 15 秒内会从列表中消失。

## 脚本命令

```bash
npm run dev          # 启动开发服务器
npm run build        # 生产构建
npm run start        # 启动生产服务器
npm run lint         # 运行 ESLint
npm run prisma       # 生成 Prisma Client
npm run worker       # 启动判题机（ID 自动分配）
npm run worker:multi # 多开判题机，例如 npm run worker:multi -- 4
npm run worker:dev   # 以 watch 模式启动判题机
npm run stress       # 判题压力测试（批量压入提交）
```

## 项目结构

```text
NovaJudge/
├─ app/              # Next.js App Router 页面与 API 路由
├─ components/       # 共享 UI 组件
├─ context/          # 前端 Providers
├─ docs/             # API 文档与说明
├─ lib/              # 认证、判题、队列、Redis、Prisma、CCS 等模块
├─ prisma/           # 数据库 Schema 与迁移
├─ public/           # 静态资源
├─ scripts/          # CLI 与维护脚本
├─ uploads/          # 题目数据与资源文件
├─ worker.ts         # 判题机（支持多实例与心跳注册）
└─ docker-compose.yml
```

## API 与 CCS

NovaJudge 提供面向比赛/题目/提交工作流的平台 API，以及兼容 ICPC CCS 的接口，
可用于外部工具、滚榜（resolver）流程与现场大屏展示。可信集成方可以使用
API Key 认证。

详见 [docs/API_DOCS.md](docs/API_DOCS.md)。

## 开源协议

NovaJudge 基于 [MIT 协议](LICENSE) 开源。
