# Windows：监考系统建立与 NovaJudge 全流程联调

本手册对应 Windows submit 适配后的两份源码，按“同一台 Windows 电脑运行所有服务”编写。
先跑通电脑端，再增加手机第二机位。所有命令使用 PowerShell；长期运行的服务各占一个终端。

此前 11 项自动验收覆盖真实桌面 submit 管理器、设备授权接口及实际 AC；本手册额外覆盖
监考 MySQL 后台、建考、考生导入、审核、Electron 界面、屏幕/摄像头直播与考试结束。
这些人工步骤需要实际操作，不应把自动接口测试结果当作整套 GUI 已验收。

## 0. 复用已有本地环境

已有本地 NovaJudge 时，可以直接进行人工联调，不必再创建判题环境或复制已有数据：

1. 在现有 NovaJudge 的服务端环境配置中设置 `NOVAJUDGE_CLI_MODE=intranet`，然后重启
   NovaJudge Web，使部署明确允许内网 submit。保持 PostgreSQL、Redis 和判题 worker 运行，
   确认 `http://127.0.0.1:3001/api/cli/settings` 返回当前测试比赛。不要用下文测试 `.env`
   覆盖现有配置；公网部署保持此开关未设置（默认关闭）。
2. 在监考源码原目录配置并启动监考 MySQL、媒体服务、后台（4031）和考生网页（4032）。
   只初始化监考自身的数据库，不把本手册的测试 `.env` 覆盖到现有 NovaJudge。
   如果监考服务已经配置并运行，直接继续下一步。
3. 使用现有比赛及其 TEAM 账号，按第 6 节配置监考考试、考生和考室：平台地址为
   `http://127.0.0.1:3001`，比赛 ID 使用现有比赛的实际 ID，双方考号和密码一致。
   已有超级管理员 API Key 可以继续使用。
4. 从第 7 节继续启动客户端并验收。提交代码必须对应现有比赛的实际题目，
   不要默认其 A 题是本手册的 A+B，也不要使用下文示例管理员口令登录已有账号。

下面第 1–5 节提供从零搭建独立测试环境的可选流程。自动化
`test:submit-windows:integration` 会创建及清理测试数据，仍须使用隔离的测试数据库；
人工复用现有环境时不要运行该脚本。

## 1. 准备工具和独立目录（从零搭建）

需要 Docker Desktop（Linux containers）、Node.js 24.x、npm、pnpm 11.16.0、Windows PowerShell 5.1。
Node 22.12.0 不能运行项目锁定的 pnpm 11.16.0；若使用较旧版本，先切换到兼容版本。
Node 可从[官方站点](https://nodejs.org/en/download)选择 24.x；pnpm 使用项目指定版本，
不要直接安装 latest。[pnpm 官方兼容表](https://pnpm.io/installation#compatibility)

```powershell
node --version
where.exe node
npm.cmd install -g pnpm@11.16.0
pnpm.cmd --version
docker version
docker compose version
powershell.exe -NoProfile -Command '$PSVersionTable.PSVersion'
```

预期：Node 显示 v24.x、pnpm 显示 11.16.0、Docker 能返回服务端信息。
如果命令仍指向旧 Node，重新打开终端，检查 `where.exe node` 和 `where.exe pnpm`。

本节从零搭建方案使用独立工作目录，数据库和上传目录一起隔离。不要在原工作区换一个空数据库继续使用原 `uploads`。
先准备包含 Windows submit 适配的两份源码。以下命令会提示输入各自目录，并将源码复制到当前用户目录下的独立测试环境；不会复制原数据库文件、上传目录或环境凭据。

```powershell
$JudgeSource = (Resolve-Path -LiteralPath (Read-Host '输入 NovaJudge 源码目录的完整路径')).Path
$ProctorSource = (Resolve-Path -LiteralPath (Read-Host '输入监考系统源码目录的完整路径')).Path
$E2eRoot = Join-Path $env:USERPROFILE 'novajudge-proctor-e2e'
if (Test-Path -LiteralPath $E2eRoot) { throw '测试目录已存在：继续使用其中的环境，或先选一个新的目录；不要覆盖原测试数据。' }
New-Item -ItemType Directory -Path $E2eRoot | Out-Null
robocopy $JudgeSource "$E2eRoot\judge" /E /XD node_modules .git .local .next uploads /XF .env .env.local /R:1 /W:1 /NFL /NDL /NJH /NJS
if ($LASTEXITCODE -ge 8) { throw 'NovaJudge 源码复制失败' }
robocopy $ProctorSource "$E2eRoot\proctor" /E /XD node_modules .git .local .next uploads /XF .env .env.local /R:1 /W:1 /NFL /NDL /NJH /NJS
if ($LASTEXITCODE -ge 8) { throw '监考源码复制失败' }
New-Item -ItemType Directory -Path "$E2eRoot\infra" | Out-Null
Copy-Item "$E2eRoot\judge\docs\windows-e2e\compose.yml" "$E2eRoot\infra\compose.yml"
Copy-Item "$E2eRoot\judge\docs\windows-e2e\mediamtx.yml" "$E2eRoot\infra\mediamtx.yml"
Copy-Item "$E2eRoot\judge\docs\windows-e2e\judge.env.example" "$E2eRoot\judge\.env"
Copy-Item "$E2eRoot\judge\docs\windows-e2e\proctor.env.example" "$E2eRoot\proctor\apps\web\.env"
Copy-Item "$E2eRoot\judge\docs\windows-e2e\desktop-config.js" "$E2eRoot\proctor\apps\desktop\src\renderer\config.js"
```

`robocopy` 返回 1 通常表示成功复制，不是失败。文中测试口令仅用于本机测试环境。
后续每个终端的命令均通过 `$env:USERPROFILE` 定位同一测试目录，无需共享上一个终端的变量。若自定义测试根目录，后续 `Join-Path` 的根路径也要同步替换。

## 2. 启动两套数据库、Redis、判题机和媒体服务

```powershell
Set-Location (Join-Path $env:USERPROFILE 'novajudge-proctor-e2e\infra')
docker compose -f compose.yml config --quiet
docker compose -f compose.yml up -d --build --wait
docker compose -f compose.yml ps
Invoke-RestMethod 'http://127.0.0.1:55050/config'
```

第一次需要下载镜像、构建包含 C/C++/Java/Python 环境的判题镜像，耗时可能较长。
`postgres`、`mysql`、`redis`、`judge` 应为 healthy；`media` 应为 running。

| 服务 | 宿主机地址 | 用途 |
| --- | --- | --- |
| PostgreSQL | 127.0.0.1:55432 | NovaJudge 测试数据库 |
| Redis | 127.0.0.1:56379 | 提交队列与 worker 心跳 |
| go-judge | 127.0.0.1:55050 | 编译和执行代码 |
| MySQL | 127.0.0.1:53307 | 监考考试、考生与会话 |
| 媒体 HTTP | 8080 / 8889 / 9997 | HLS / WHIP / 管理接口，仅回环 |
| WebRTC | 127.0.0.1:8189 TCP/UDP | 同机屏幕和摄像头媒体 |

本手册的媒体配置保留监考 HTTP 鉴权。当前桌面和手机使用 WHIP，首轮不启动旧 RTMPS 入口，
也无需本机证书。不要改用监考根目录的生产 Compose：它还需要生产域名、RTMPS 和证书等配置。

NovaJudge、监考后台、考生网页都是宿主机进程，不在 Docker 内，所以它们的 `.env` 使用上述
`127.0.0.1` 端口。媒体容器通过 `host.docker.internal:4031` 回调监考鉴权接口。

## 3. 初始化并启动 NovaJudge

终端 A：

```powershell
Set-Location (Join-Path $env:USERPROFILE 'novajudge-proctor-e2e\judge')
# 避免旧终端环境变量覆盖刚复制的测试 .env。
Remove-Item Env:DATABASE_URL,Env:REDIS_URL,Env:GO_JUDGE_API,Env:NODE_ENV,Env:NOVAJUDGE_URL,Env:NOVAJUDGE_CLI_MODE -ErrorAction SilentlyContinue
npm.cmd install --ignore-scripts
npx.cmd prisma db push
npm.cmd run prisma
npx.cmd tsx scripts/copy-monaco.ts
npm.cmd run dev -- --webpack
```

这里显式运行初始化步骤，因此安装依赖时跳过项目的 `postinstall`。不需要 `--accept-data-loss`。
若数据库命令提示删除已有数据，先停止并检查是否连接错库。
测试模板已设置 `NOVAJUDGE_CLI_MODE=intranet`；仅当服务端明确启用该模式时，submit 才可使用。

终端 B，保持运行：

```powershell
Set-Location (Join-Path $env:USERPROFILE 'novajudge-proctor-e2e\judge')
Remove-Item Env:DATABASE_URL,Env:REDIS_URL,Env:GO_JUDGE_API,Env:NODE_ENV -ErrorAction SilentlyContinue
npm.cmd run worker -- --id windows-manual-e2e
```

浏览器访问 `http://127.0.0.1:3001`，使用全局管理员登录：

- 用户名：`admin`
- 首次创建密码：`JudgeE2eOnly2026!`

进入后台 Dashboard，确认 `windows-manual-e2e` worker 在线。
若数据库已有管理员，环境变量不会重置其密码。

## 4. 建立可真实 AC 的测试比赛

另开一次性终端，生成可导入题包和 C++ 代码：

```powershell
Set-Location (Join-Path $env:USERPROFILE 'novajudge-proctor-e2e\judge')
node docs/windows-e2e/make-fixture.mjs
```

输出在当前用户目录下的 `novajudge-proctor-e2e\judge\.local\windows-e2e-fixture`。
脚本只创建新文件；如果已生成，不必再次运行。

在 NovaJudge 后台依次操作：

1. 题库 → **Import**，导入 `A-plus-B.zip`。不要选择更新已有题目。
2. 新建比赛，标题 `Windows 全流程联调`，类型 **PUBLIC**（比赛访问类型；与部署的公网/内网模式是不同概念）。
3. 开始时间设为当前时间前 1–2 分钟，结束时间设为两小时后，封榜时长设为 0。
4. 在比赛题目管理中加入 `Windows E2E A+B`，题号设为 **A**。
5. 记下这个比赛的数字 ID，下文记作 `N`；以页面实际 ID 为准，不能写死为 1 或 2。
6. 比赛用户管理 → Teams → Batch Import，导入一个 TEAM 账号。

可在 PowerShell 复制这一行，再粘贴到批量导入框；它用的是 Tab 分隔，不是逗号：

```powershell
Set-Clipboard "team0001`tTeamE2e2026!`tWindows联调队`t测试学校`t联调选手`tA01`t`t0"
```

预览确认 `username=team0001`、`password=TeamE2e2026!` 后导入，**不粘贴表头**。

7. 后台 **System Settings → submit 命令行比赛**，选择比赛 `N` 并保存。
8. 后台 **API Keys**，用全局超级管理员创建 `Windows监考联调` 密钥，确认启用。保留供监考后台填写。

可访问 `http://127.0.0.1:3001/api/cli/settings`，确认显示的比赛就是 `N`。
API Key 不填到选手终端、桌面配置文件或手机页面。

本轮 NovaJudge 部署已通过 `NOVAJUDGE_CLI_MODE=intranet` 启用内网 submit。比赛的 PUBLIC/PRIVATE 只控制比赛访问权限，不会开启 submit。
首轮必须使用 PUBLIC：当前监考后台 `loginNovaJudge()` 尚未把私有赛密码传给 NovaJudge。
虽然 NovaJudge 授权接口支持私有赛，监考后台表单和转发还需补齐后才能人工验收该场景。

## 5. 初始化监考系统，启动后台和考生网页

终端 C：

```powershell
Set-Location (Join-Path $env:USERPROFILE 'novajudge-proctor-e2e\proctor')
Remove-Item Env:DATABASE_URL,Env:NODE_ENV,Env:BOOTSTRAP_ADMIN_PASSWORD -ErrorAction SilentlyContinue
pnpm.cmd install --frozen-lockfile
pnpm.cmd db:generate
pnpm.cmd db:push
Push-Location apps/web
try {
  node --env-file=.env --import tsx scripts/seed.ts
  if ($LASTEXITCODE -ne 0) { throw '监考初始化失败，请检查 web/.env 和数据库连接。' }
} finally { Pop-Location }
pnpm.cmd dev:web
```

seed 特意显式加载 `apps/web/.env`，确保使用已配置的管理员口令。
浏览器访问 `http://127.0.0.1:4031`，使用本地账号登录：

- 用户名：`admin`
- 首次创建密码：`ProctorE2eOnly2026!`

不要选择协会官网外部账号登录；本次本机验收无需配置官网 App Key 或 Hydro。

终端 D：

```powershell
Set-Location (Join-Path $env:USERPROFILE 'novajudge-proctor-e2e\proctor')
$env:NEXT_PUBLIC_PROCTOR_API_BASE = 'http://127.0.0.1:4031'
pnpm.cmd dev:client
```

访问 `http://127.0.0.1:4032` 应能显示考生网页。所有页面均使用 `127.0.0.1`，避免和 `localhost` 混用 Cookie/origin。

## 6. 建立监考老师、考试、考生和考室

### 6.1 建一个本地监考老师

后台 → 用户管理 → 导入本地用户。下载页面模板后按下面内容填一行：

```csv
用户名,姓名,学校,学号,邮箱,密码,状态,角色
proctorqa,联调老师,测试学校,990001,,TeacherE2e2026!,启用,普通管理员
```

也可用表单逐项填写。之后以该本地老师账号查看监考页面；超级管理员继续负责设置。

### 6.2 发布 NovaJudge 监考考试

访问后台 `/dashboard/exams/new`，填写：

| 字段 | 值 |
| --- | --- |
| 考试类型 | NovaJudge（监考与浏览器） |
| 比赛类型 | 个人赛 |
| 标题 | Windows 全流程联调 |
| 开始、结束时间 | 与 NovaJudge 比赛一致；首次登录时应刚开考 |
| NovaJudge 平台域名 | `http://127.0.0.1:3001`，不带 `/contest/N` |
| NovaJudge 比赛 ID | 第 4 步记录的 `N` |
| NovaJudge 外榜 API Key | 第 4 步创建的超级管理员密钥 |
| NovaJudge 数据时区 | Asia/Shanghai |
| 比赛管理员 | admin 或 proctorqa |
| 手机第二机位 | 首轮取消；第 11 步再打开 |
| 电脑前置摄像头 | 有摄像头则勾选；没摄像头先取消 |
| 完整录像 | 要验收录像则勾选 |

保存后记下系统生成的 **10 位监考考试编号**，下文记作 `E`。
`E` 用于监考登录，`N` 用于 NovaJudge，二者不可混用。
不要使用初始化时自动生成的“系统测试考试”，它属于 Hydro 流程。

### 6.3 导入考生

该考试 → 考生管理 → 新增考生 → 下载模板，填写并导入：

```csv
考号,姓名,密码,学校,学号,参赛组别,座位号
team0001,联调选手,TeamE2e2026!,测试学校,20260001,正式参赛,A01
```

考号、密码必须与 NovaJudge 的 TEAM 账号完全一致。姓名、学校、学号也必须填写。
监考比赛类型为个人赛，不影响 NovaJudge 账号必须具有 TEAM 权限。

### 6.4 分配考室

考试 → 考室管理 → 添加考室：

- 考室名称：`联调考室`。
- 需要第二机位：取消；前置摄像头：与本轮测试设备一致。
- 登录方式：**考试编号＋姓名＋考号＋密码**。
- 审核方式：**手动审核**。
- 添加监考：填写监考老师学号 `990001`。
- 添加考生：选择 `team0001`，然后保存。

**考室新建时两个摄像头选项默认开启，必须在考室里再检查一次。**
考室要求优先于考试默认值。没有分配考室会导致登录被拒。

## 7. 从修改后的源码启动 Windows 监考客户端

不要启动之前安装的旧版 exe。使用复制后、已修复开发模式内网状态的源码。
配置文件已由第 1 步替换：后台和更新源都是 `http://127.0.0.1:4031`，channel 为 `intranet`。

用**同一 Windows 用户**打开管理员 PowerShell，终端 E：

```powershell
Set-Location (Join-Path $env:USERPROFILE 'novajudge-proctor-e2e\proctor')
Remove-Item Env:PROCTOR_BUILD_CHANNEL -ErrorAction SilentlyContinue
pnpm.cmd dev:desktop
```

`dev:desktop` 会先构建再启动 Electron。清除 `PROCTOR_BUILD_CHANNEL` 是为了避免构建脚本
将本地地址覆盖成正式域名。不要通过另一个管理员账号的 UAC 凭据运行客户端，否则自动 submit
会拒绝写入错误用户的配置目录。

依次执行：

1. 检测系统权限，按界面授权。当前桌面登录前仍检查 Windows 摄像头、麦克风访问权限；
   即使关闭前摄采集要求，也需要开启这些系统权限。
2. 检测屏幕与摄像头；屏幕检测必须通过，不能因关闭两个摄像头就跳过屏幕采集。
3. 进入登录 → 账号密码登录。
4. 输入 `E`、姓名 `联调选手`、考号 `team0001`、密码 `TeamE2e2026!`。
5. 客户端显示等待审核。首轮关闭第二机位，不要求手机、身份照片、环境视频。
6. 老师浏览器进入该考试的登录请求，选择此考生，点击 **通过登录**。
7. 客户端显示审核通过后，点击开始考试并确认。

预期：进入 NovaJudge 的 `/contest/N`，身份为 team0001，随后显示 **submit 已就绪**。
老师实时监考页面能看到屏幕；开启摄像头时还能看到前摄画面。
开启录像后等待至少 30 秒，再检查历史录像/记录，确认能播放。

普通考试开始前 40 分钟才开放登录；首次入场拖到开考 15 分钟之后可能被拒。
配置耗时较长时，重新调整两边考试时间，或由老师使用“继续考试”功能放行。

## 8. 在终端提交，并核对实际评测

看到 submit 已就绪后，重新打开一个普通 PowerShell（与监考是同一个 Windows 账户）：

```powershell
Set-Location (Join-Path $env:USERPROFILE 'novajudge-proctor-e2e\judge\.local\windows-e2e-fixture')
Get-Command submit
submit status
submit A.cpp
```

预期 `Get-Command` 指向当前用户的 `%LOCALAPPDATA%\NovaJudge\submit\submit.cmd`。
`submit status` 应显示正确队伍、比赛和 monitoring client 授权来源。

先输入 `n`：应取消，NovaJudge 不增加提交。再运行 `submit A.cpp` 并输入 `y`＋回车：

- 终端显示比赛内提交编号和详情链接。
- NovaJudge 状态页出现 team0001 对 A 题的提交。
- 评测最终变为 **ACCEPTED**，题目有两组测试数据。
- 老师监考页面仍保持屏幕在线，开启摄像头时前摄在线。

如果新终端没有刷新 PATH，先用完整路径验证，不要重复网页登录：

```powershell
& "$env:LOCALAPPDATA\NovaJudge\submit\submit.cmd" status
& "$env:LOCALAPPDATA\NovaJudge\submit\submit.cmd" A.cpp
```

出现普通网页配对说明没有拿到监考绑定，回第 7 步检查内网配置、登录阶段和 submit 状态。
不要用 `submit login` 替代监考自动绑定验收。

## 9. 验收撤销、重登及结束考试

建议按顺序操作，结束考试放最后：

| 操作 | 预期 |
| --- | --- |
| 输入 n 或直接回车 | 没有新增提交 |
| 正常输入 y | 新增一次提交，最终 AC |
| NovaJudge 管理员关闭 CLI 比赛 | submit 被拒绝；已有队伍身份不能继续提交 |
| 重新选择比赛 N | 旧设备授权不会恢复；从监考重新登录/准备 submit |
| 老师操作“重新登录 NovaJudge” | 旧监考授权失效；客户端取得新授权后可重新提交 |
| 复制 Cookie 到普通浏览器，或普通账号密码登录该队伍 | 无法绕过监考绑定 |
| 桌面“结束考试” | 本客户端提交授权撤销，拥有的本地配置被清理 |

结束考试确认文字按界面要求输入，例如：

```text
考号team0001，姓名联调选手确认结束考试
```

结束后只检查配置是否存在，不打印里面的设备令牌：

```powershell
Test-Path "$env:USERPROFILE\.novajudge-submit.json"
& "$env:LOCALAPPDATA\NovaJudge\submit\submit.cmd" status
```

若没有后续其他登录覆盖配置，预期为 False / Not connected。考试结束不会把该队伍恢复成普通网页登录账号。
需要再次完整登录时，建另一测试账号或由老师按系统规则允许重新进入。

公网模式可在单独一轮测试：退出客户端，将测试副本 config.js 的 channel 改为 `public`，
重新 `pnpm.cmd dev:desktop`，确认不会自动签发/启用 submit。这里验收开发模式分支；
正式统一安装包的自动内网/公网切换，还需发布版本清单和 HTTPS 后台后验收。
另外，可在独立测试 NovaJudge 中移除 `NOVAJUDGE_CLI_MODE` 后重启 Web，确认 submit 接口拒绝使用；
仅改变桌面 channel 不能替代服务端部署开关验收。恢复内网测试时重新设置该变量并重启。

## 10. 可重复运行的自动检查

以下命令不替代上面的 GUI 和媒体人工验收：

```powershell
Set-Location (Join-Path $env:USERPROFILE 'novajudge-proctor-e2e\judge')
npm.cmd run test:submit-windows
npm.cmd run test:cli-device
npm.cmd run test:contest-access
$env:PROCTORING_DESKTOP_ROOT = (Join-Path $env:USERPROFILE 'novajudge-proctor-e2e\proctor')
$env:SUBMIT_TEST_URL = 'http://127.0.0.1:3001'
npm.cmd run test:submit-windows:integration
```

Web、worker、Docker 必须仍运行。该脚本临时改变全站 CLI 比赛再恢复，因此在结束手工考试后运行。
它仅清理自动测试自己创建的数据，保留手工创建的比赛；报告在测试 judge 的 `.local/submit-windows-qa/report.json`。

监考端测试：

```powershell
Set-Location (Join-Path $env:USERPROFILE 'novajudge-proctor-e2e\proctor')
pnpm.cmd --filter @cwnupaa/proctor-desktop typecheck
pnpm.cmd --filter @cwnupaa/proctor-desktop build
pnpm.cmd --filter @cwnupaa/proctor-desktop test:submit
```

## 11. 再加入手机第二机位和局域网设备

先确认第 8 步已 AC 且屏幕直播可见，再开启这一轮。手机与电脑在同一局域网。
手机上的 `127.0.0.1` 是手机自身，不能继续使用首轮回环地址。

1. 用 `ipconfig` 查电脑局域网 IPv4，以下示例为 `192.168.1.20`，必须替换成实际地址。
2. 按 [mkcert 官方说明](https://github.com/FiloSottile/mkcert#installation)安装 Windows 版 mkcert，生成可信开发证书：

```powershell
Set-Location (Join-Path $env:USERPROFILE 'novajudge-proctor-e2e\infra')
New-Item -ItemType Directory -Force certs | Out-Null
mkcert -install
mkcert -cert-file certs/mobile.pem -key-file certs/mobile-key.pem localhost 127.0.0.1 192.168.1.20
mkcert -CAROOT
```

3. 把上一步 CA 目录中的 **rootCA.pem** 安装并信任到测试手机；iOS 还需开启完全信任。
   不复制或分享 `rootCA-key.pem`。详见 [mkcert 手机说明](https://github.com/FiloSottile/mkcert#mobile-devices)。
4. 编辑 `infra/compose.yml` 的 media：将 `MTX_WEBRTCADDITIONALHOSTS` 改为电脑局域网 IP；
   把 8189 两行改为 `"8189:8189/tcp"`、`"8189:8189/udp"`，让手机能够建立媒体连接。
   其余管理/数据库端口保持回环。然后执行：

```powershell
Set-Location (Join-Path $env:USERPROFILE 'novajudge-proctor-e2e\infra')
docker compose -f compose.yml up -d media
```

5. 为本测试实例允许 Windows 防火墙私有网络上的 TCP 3443、TCP/UDP 8189。
6. 考生网页终端 D：停止原进程，清除固定 HTTP 后台配置后重启：

```powershell
Set-Location (Join-Path $env:USERPROFILE 'novajudge-proctor-e2e\proctor')
Remove-Item Env:NEXT_PUBLIC_PROCTOR_API_BASE -ErrorAction SilentlyContinue
pnpm.cmd dev:client
```

7. 新开终端 F 运行手机 HTTPS 代理：

```powershell
Set-Location (Join-Path $env:USERPROFILE 'novajudge-proctor-e2e\proctor')
$env:PROCTOR_DEV_TLS_CERT = (Join-Path $env:USERPROFILE 'novajudge-proctor-e2e\infra\certs\mobile.pem')
$env:PROCTOR_DEV_TLS_KEY = (Join-Path $env:USERPROFILE 'novajudge-proctor-e2e\infra\certs\mobile-key.pem')
pnpm.cmd dev:mobile:proxy
```

代理在 3443 提供 HTTPS，将 `/api` 转发到 4031，其他页面转到 4032。
手机访问 `https://192.168.1.20:3443`，应没有证书警告且可授权摄像头。
8. 测试副本的 `apps/desktop/src/renderer/config.js` 中，将 `PROCTOR_MOBILE_WEB_URL` 和
   `PROCTOR_PUBLIC_API_URL` 均改为 `https://192.168.1.20:3443`。桌面本地后台与更新源保留 4031，channel 保留 intranet。
9. 在启动桌面的终端设置 CA，然后重新启动桌面；Node 的 TLS 不会自动使用 Windows 根证书库：

```powershell
$env:NODE_EXTRA_CA_CERTS = Join-Path (mkcert -CAROOT) 'rootCA.pem'
pnpm.cmd dev:desktop
```

10. 新建一轮测试考试/账号，或调整尚可登录的考试，在考试和考室中开启第二机位。
    将考室登录方式明确改为 **第二机位扫码**；首轮的账号密码模式不接受这类扫码请求。
    手机打开考生网页，填写考试/考生信息、上传身份照片和 3–15 秒环境视频，
    扫描桌面二维码并提交登录请求，老师审核，桌面确认开始。
11. 预期老师看到屏幕、前摄（若要求）和手机画面，重新提交 A.cpp 仍能 AC；检查手机断网重连与录像。

这一步是同机服务加真实手机；若把桌面移到另一台电脑，还需把 NovaJudge origin、监考后台、
更新源和考生网页改成那台电脑可访问的 HTTPS 地址，并统一证书信任、端口和版本服务。
打包版不接受 HTTP 更新源，不能把开发模式配置直接当正式部署配置。

## 12. 常见故障与关闭顺序

| 现象 | 优先检查 |
| --- | --- |
| pnpm 提示 Node 太旧 | `where.exe node`；Node 22.12 不满足当前 pnpm；使用 24.x |
| 管理员密码不对 | 是否首次 seed；是否显式加载 web/.env；已有账号不会重置 |
| 找不到考试 | 是否把 NovaJudge 数字 ID 当作监考 10 位编号；是否已分配考室 |
| 要求手机但已取消 | 考室自己的“需要第二机位”可能仍开启 |
| 屏幕检测不通过 | 桌面权限、采集设备、同用户管理员启动；屏幕始终必需 |
| NovaJudge 返回 403 | Key 是否超级管理员且启用；比赛是否 PUBLIC；两边考号密码是否一致 |
| 网页能进但 submit 未就绪 | 桌面源码是否含开发模式修复；两个 origin 是否一致；channel 是否 intranet；服务端 NOVAJUDGE_CLI_MODE 是否 intranet 且已重启；CLI 比赛是否 N |
| submit 调到旧版 | `Get-Command submit`；新开终端；用当前安装目录的 submit.cmd 全路径 |
| 提交一直 PENDING | worker 是否运行；Web/worker 的 Redis 和数据库配置是否完全一致 |
| SYSTEM_ERROR | go-judge 的 /config；worker 日志；题目是否包含测试文件；是否有编译器 |
| 老师看不到直播 | media 日志、4031 是否被容器访问、WHIP/HLS 配置、8189、摄像头要求 |
| 手机拒绝摄像头 | 是否真正 HTTPS 且证书受信；不能用手机 localhost 或裸 LAN HTTP |
| 第二机位 ICE 失败 | MTX_WEBRTCADDITIONALHOSTS 是否实际 LAN IP；8189 映射和防火墙 |

查看媒体日志：

```powershell
Set-Location (Join-Path $env:USERPROFILE 'novajudge-proctor-e2e\infra')
docker compose -f compose.yml logs --tail 100 media
```

先从桌面结束考试并退出，再在各服务终端按 Ctrl+C，最后停止 Docker 服务：

```powershell
Set-Location (Join-Path $env:USERPROFILE 'novajudge-proctor-e2e\infra')
docker compose -f compose.yml stop
```

`stop` 保留测试数据库和文件，下一次 `up -d --wait` 可继续。不要执行 `down -v`，除非明确要丢弃整套测试数据。
保留实际比赛 ID、10 位考试编号、AC 记录、三路画面结果与撤销结果，作为这一轮人工验收记录。
