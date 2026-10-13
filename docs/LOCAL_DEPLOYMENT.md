# 本机部署

部署目录：`/Users/jiangys/Jiangys/Program/NovaJudge`。

网页入口：[NovaJudge](http://localhost:3001)，后台入口：[管理后台](http://localhost:3001/admin)。
管理员账号为 `admin`，随机密码与验收比赛账号保存在本机私有文件
`/Users/jiangys/Jiangys/Program/NovaJudge/.local/access.json`，文件权限为仅当前用户读写。
不要把 `.env` 或该文件提交到仓库。

## 启动与停止

在此项目目录运行：

```sh
npm run local:status
npm run local:start
npm run local:restart
npm run local:stop
```

首次安装后的本机服务已完成初始化与生产构建。停止操作保留数据库、缓存和附件。
更新源代码后，先运行 `npm run build`，再运行 `npm run local:restart`。
数据库结构变化时，先备份，再根据项目的数据变更执行相应升级。

网页和两个 Worker 由 macOS LaunchAgent 管理，退出终端后继续运行；登录用户时会启动。
PostgreSQL、Redis 和判题服务由 Docker Desktop 管理，需要 Docker Desktop 正常运行。

| 服务 | 本机地址 | 保存位置 |
| --- | --- | --- |
| 网页 | `127.0.0.1:3001` | 原生 Node.js 生产服务 |
| PostgreSQL | `127.0.0.1:5433` | `novajudge-local_postgres_data` Docker 卷 |
| Redis | `127.0.0.1:6380` | `novajudge-local_redis_data` Docker 卷 |
| go-judge | `127.0.0.1:5050` | `novajudge-local-judge` 独立容器 |
| Worker | `local-1`、`local-2`，各并发 2 | 原生 Node.js 服务 |
| 附件、测试数据 | 项目 `uploads/` | 本机文件 |
| 运行日志 | 项目 `.local/logs/` | 本机文件 |

基础服务使用 `compose.local.yml`，与本机已有 Hydro 和 CWNUPAA 服务分开。
数据备份应同时包含 PostgreSQL 数据、`uploads/` 和受保护的 `.env`。
不要执行删除卷的操作来停止服务。

## 已处理的部署问题

- ARM 软件源、根证书和无图形界面的 Java 21 编译运行环境。
- 固定 go-judge 为 `v1.11.2`：本次部署取得的 `latest` 为 `v1.13.2`，真实运行返回
  `container: stdout: lstat stdout: operation not permitted`；固定版本后 C、C++、Java、PyPy3
  及标准、SPJ、交互、两轮通信题均通过真实判题。
- 时区统一为 `Asia/Shanghai`，本机 HTTP 登录 Cookie 配置适配本机地址。
- Worker 与网页常驻运行，重启时等待旧进程退出，避免 LaunchAgent 启动竞争。

功能测试范围和实际结果见 [本机验收报告](LOCAL_TEST_REPORT.md)。
