# 统一版本部署与维护交接

唯一维护仓库：<https://github.com/CWNU-Open-Source-Community/NovaJudge>。
公网、校内和其他学校使用同一套源码与发布版本，通过部署配置启用功能。
旧私有仓库用于历史查阅，停止新增功能；生产切换验收后再归档。

## 本次变化

- 整合原私有版的外部账号、赛后补题、权限、正式赛统计、奖项、队列恢复与多 Worker 改进。
- 删除考场推流控制台和推流设置。`/admin/judge-monitor` 保留判题监控，旧 `/admin/monitor` 地址跳转至此。
- 监考专用登录、Windows/macOS submit 和 printfile 继续可用。CLI 仍仅在显式配置内网模式后启用。
- 新安装默认关闭外部登录；已有私服的外部账号、封禁状态、登录开关保持不变。
- `npm ci` / `npm install` 只安装依赖、生成 Prisma 客户端和复制编辑器资源，不访问或修改业务数据库。
- 数据库统一通过 `npm run db:deploy` 升级。生成代码不提交 Git。

## 新安装

要求 Node.js 22、npm、PostgreSQL 16、Redis 7 和可用的 go-judge。
Web、Worker、数据库与沙箱可以分开部署；所有 Worker 必须能读取相同的题目数据。

```sh
git clone https://github.com/CWNU-Open-Source-Community/NovaJudge.git
cd NovaJudge
cp .env.example .env
# 编辑 .env，填写数据库连接、独立的 JWT_SECRET、管理员用户名和密码。
npm ci
docker compose up -d --build --wait
npm run db:deploy
npm run build
```

分别启动 Web 和 Worker，并交由现有进程管理器管理：

```sh
npm run start
npm run worker:multi -- 2
```

访问 `http://localhost:3001`。超级管理员按 `.env` 中的引导配置创建。
已有数据库和缓存服务的部署可跳过 Compose 启动步骤，使用对应服务地址。
生产环境需要反向代理、HTTPS，并按实际使用方式设置 `ENABLE_SECURE_COOKIE`。

## 从旧公开版或旧私有版升级

1. 记录当前代码版本、服务名、启动目录和环境变量；停止 Web、Worker 等所有数据库写入者。
2. 备份数据库、`uploads/`、实际共享题目目录和 `.env`，确认备份可恢复。
3. 在新发布目录检出经过 CI 验证的同一个版本，安装依赖。私有部署首次切换可以重新克隆主仓库，沿用原 `.env` 和题目文件路径，不必合并旧仓库历史。
4. 在数据库副本上先执行以下升级和验收，再对正式库执行。

```sh
npm ci
npm run db:deploy
npm run db:status
npm run build
```

5. 使用原进程管理器重启 Web 和所有 Worker。不要让旧、新版本 Worker 同时消费一个队列。
6. 验证管理员登录、外部登录（若启用）、现有题目附件、Polygon 导入、普通/交互/通信评测、榜单、重判、CLI 和打印。

仓库提供的 Linux `npm run upgrade` 会检查环境、启动基础服务、安装依赖、执行数据库升级并构建。
它不拉取 Git、不自动备份、不重启 Web/Worker；在执行前完成版本选择和备份，执行后用原进程管理器重启。

### 数据库升级规则

旧版本使用 `db push`，没有完整的初始化迁移。统一版建立了完整基线：

- 空数据库：创建全部表，再执行统一版迁移。
- 与最后公开版或私有版结构一致的旧库：先精确比对结构，记录已有基线，再执行只增加字段/索引的升级。
- 已经采用统一版迁移的库：正常执行后续未应用迁移。
- 不认识的旧库结构、失败迁移或并行升级：停止并报错，不自动删表、重置数据库或删除迁移历史。

`prisma/legacy-schemas/` 是只读的旧库识别快照。`prisma/legacy-migrations/` 仅供历史查阅，
其中包括会删除外部账号字段的旧 SQL，**不能作为升级顺序执行**。
现有 `_prisma_migrations` 记录不删除，应用数据和自增序列不重建。
系统设置的默认值改为关闭外部登录，只影响新记录，不修改原有开关值。

若提示结构不匹配，在副本上使用 `prisma migrate diff` 检查实际差异，确认缺失的旧升级后再迁移；
不要通过跳过检测或执行 `migrate reset` 来解决。

## 部署配置

| 配置 | 用途 |
| --- | --- |
| `DATABASE_URL`、`REDIS_URL`、`GO_JUDGE_API` | 各部署自己的基础服务 |
| `JWT_SECRET`、`SUPER_ADMIN_USERNAME`、`SUPER_ADMIN_PASSWORD` | 各部署自己的登录配置 |
| `NOVAJUDGE_URL` | 选手可访问的站点地址 |
| `NOVAJUDGE_CLI_MODE` | 默认为 `public`；需要内网 CLI 时设置为 `intranet` |
| `EXTERNAL_AUTH_URL`、`APP_KEY` | 可选外部认证接口及应用密钥；密钥只放服务器环境中 |
| `NOVAJUDGE_EXTERNAL_LOGIN_LABEL`、`NOVAJUDGE_EXTERNAL_LOGIN_URL` | 可选外部登录弹窗显示的认证平台名称与链接 |
| `NOVAJUDGE_SITE_NAME` | 站点名称，默认 NovaJudge |
| `NOVAJUDGE_SITE_DESCRIPTION` | 页面描述，默认 XCPC Online Judge |
| `NOVAJUDGE_FOOTER_TEXT` | 可选的学校/组织页脚文字 |
| `NOVAJUDGE_ORG_MAP_PATH` | 后台首次保存前使用的组织映射文件，默认 `config/org-map.json` |
| `PROBLEM_DATA_ROOT` | Worker 读取的共享题目根目录，内容应对应 Web 的 `uploads/problems` |
| `JUDGE_CONCURRENCY`、`JUDGE_WORKER_COUNT` | 单 Worker 并发与本机 Worker 数量 |
| `GO_JUDGE_REQUEST_TIMEOUT_MS` | 可选 go-judge HTTP 超时；运行请求会覆盖沙箱兜底时间 |

超级管理员在 **站点配置 → 组织管理** 维护组织名称、学校别名、组织 ID、两位国家或地区代码和 Logo。
后台首次保存时会将原 JSON 映射一并保存到数据库，兼容 `{"学校名称":"organization-id"}` 和带 `id`、`country` 的条目。
之后的编辑直接用于排行榜和新请求的 CCS 数据。组织 Logo 随数据库一起备份。
修改站点名称、页脚等环境配置后重新构建并重启 Web。
旧推流环境变量已不再读取，可以在维护部署配置时移除。

### 外部登录协议

配置认证 URL 后，管理员在 **Settings → Allow External Login** 中启用。
没有数据库开关记录或没有有效 HTTP(S) 认证地址时，登录入口关闭。
保留以下已有认证协议，方便原私服直接升级：

```json
{ "account": "username", "credential": "password", "loginType": "password", "appKey": "server-side key" }
```

认证服务需返回 HTTP 成功响应及以下 JSON；`realName`、`numberId`、`email` 可选：

```json
{ "code": 200, "data": { "userId": "stable-user-id", "userAccount": "username", "realName": "Name", "numberId": "Student ID", "email": "user@example.com" } }
```

NovaJudge 按稳定的 `userId` 关联本地外部账号。封禁状态由本地管理员维护，外部登录不会清除封禁。
关闭外部登录开关停止新的外部登录；需要停用已有账号时使用 **External Accounts → Ban**。

## 备份和回滚

数据库与 `uploads/` 必须一起备份；外置的组织映射、共享题目目录和服务配置也需要保留。
示例使用 PostgreSQL 的连接环境变量认证，避免把密码写入命令历史：

```sh
pg_dump --format=custom --file=novajudge-before-upgrade.dump
```

这些变量应指向待备份数据库。备份文件和 `.env` 放在仓库之外且限制访问。
先在新建的空数据库中用 `pg_restore --dbname=<restore-database> <backup-file>` 演练恢复。
若升级验收失败，停止新服务，恢复匹配的数据库/文件备份，切回记录的旧代码与依赖后重启。
不要在已经产生新提交后直接恢复旧备份；先决定新数据的保留方式。

## 维护和交接

- 功能修改统一向主仓库提交 PR，CI 通过后合并，生产使用同一个已发布版本标签。
- 新数据库变更同时提交 `prisma/schema.prisma` 和新的迁移，不编辑已发布的迁移文件。
- 本地 `npm test` 跑单元和 CLI 回归，`npm run lint` 和 `npm run build` 检查代码与构建。
- 设置 `TEST_DATABASE_URL` 后运行 `npm run test:database-upgrade`，验证空库、两种旧库、重复升级和拒绝未知结构。测试仅创建、删除随机测试 schema。
- CI 自动运行上述数据库测试、数据库初始化、单元回归、通知数据库集成测试和生产构建。
- 交接组织仓库维护权限、服务器/进程管理器、备份位置、域名证书、数据库及认证服务配置；真实密钥通过组织的凭据管理方式交接。
- 切换后在旧私有仓库注明主仓库地址；确认所有部署都已迁移后再归档旧仓库。

排障顺序：先检查基础服务健康状态，再检查 Web/Worker 日志和 **Judge Monitor**。
Redis 不可用会使入队快速失败；Worker 最终失败会回写 SYSTEM_ERROR。
修复基础服务后按提交重判，避免直接修改评测结果。
