# macOS 与 Windows 选手命令行

`submit` 安装在选手自己的电脑上，用于在终端向 NovaJudge 提交比赛代码。
Windows 10 / 11 使用内置 Windows PowerShell 5.1；Apple Silicon 和 Intel Mac 使用内置的 Bash、curl 和 osascript。
无需安装 Node.js、Python、Homebrew、Xcode 或其他运行时，也不需要管理员权限、克隆仓库或 npm。

## 仅在内网部署启用

submit 默认关闭。只有内网 NovaJudge 的 Web 服务可以设置以下环境变量，然后重启服务：

```env
NOVAJUDGE_CLI_MODE=intranet
```

随后在后台系统设置中选择当前命令行比赛。部署开关与比赛选择必须同时满足；公开赛/私有赛
表示是否需要比赛密码，不代表公网/内网。公网部署应不设置此变量，或保持 `NOVAJUDGE_CLI_MODE=public`。
不要根据请求的 Host、转发头或选手 IP 自动启用，也不要将已启用的内网实例通过公网代理开放。

关闭时不展示安装入口，`/cli` 和绑定页面显示“页面未找到”，安装下载、绑定与提交 API 拒绝使用；
旧版 CLI 和已签发的设备授权同样受限。设备注销仍可撤销授权。
普通网页提交与 `loginSource: "PROCTORING"` 的监考登录不受这个开关影响。

## 安装

访问比赛网站的 `/cli` 页面，复制该页面生成的安装命令。比赛提交页和公共页脚也有入口。

### Windows

打开 Windows PowerShell，以普通用户运行（将地址替换为实际比赛网站）：

```powershell
$installer = Join-Path $env:TEMP 'novajudge-install.ps1'
Invoke-WebRequest -UseBasicParsing 'https://judge.example/api/cli/install?platform=windows' -OutFile $installer
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -Url 'https://judge.example'
```

安装目录为 `%LOCALAPPDATA%\NovaJudge\submit`，安装器将其加入当前用户的 PATH。
关闭并重新打开终端应用（包括 Windows Terminal、VS Code）；CMD 和 PowerShell 均可运行 `submit A.cpp`。
当前 PowerShell 窗口立即使用：

```powershell
$env:Path = "$env:LOCALAPPDATA\NovaJudge\submit;$env:Path"
submit A.cpp
```

安装包使用 `submit.cmd` / `submit.bat` 启动器和 `novajudge-submit.ps1`，避免 PowerShell 优先解析
同名 `.ps1` 被默认执行策略拦截。无需修改全局执行策略；组织强制的组策略仍由管理员管理。
旧版桌面 `novajudge-submit.json` 的用户名密码文件不再使用，改用网页或监考专用设备授权。
如仍出现旧版登录提示，在 PowerShell 运行 `Get-Command submit`（CMD 使用 `where.exe submit`）
查看实际命令路径，移除或调整旧命令/别名。也可直接运行
`& "$env:LOCALAPPDATA\NovaJudge\submit\submit.cmd" A.cpp`。

### macOS

将示例中的 `https://judge.example` 替换为实际内网比赛网站：

```bash
curl -fsSL 'https://judge.example/api/cli/install' | /bin/bash -s -- --url 'https://judge.example'
```

选手在另一台电脑上使用时，应打开实际比赛网站，使用它的地址；`localhost` 指选手自己的电脑。
没有配置网站地址时，客户端会报错提示安装或指定 `--url`，不会自动连接本机。
安装命令会从该网站下载原生脚本到 `~/.local/bin/submit` 并保存默认网站地址。
安装后打开新终端，或在当前终端运行：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## 管理员指定当前比赛

管理员在后台 **System Settings → submit 命令行比赛** 中为全站选择当前比赛并保存。
内网部署已启用后，比赛选择立即生效，无需重启。选「关闭命令行提交」可停用比赛提交。
网站 `/cli` 页面展示当前指定的比赛；未配置时，选手可以先安装，然后联系管理员。
从其他比赛的提交页进入安装说明，也不会改变命令行的目标比赛。

## 内网监考登录

使用支持此功能的 Windows 或 macOS 监考客户端时，连接内网后台并完成 NovaJudge 登录后，
客户端会安装 `submit` 并自动绑定当前队伍。新开终端运行 `submit A.cpp`，核对信息并输入
`y` 即可提交，无需再次网页登录。已有终端首次安装后需要重新打开以载入命令路径。

公网模式不安装或启用此功能。退出监考、结束考试、切换账号或切换到公网会清理监考客户端
建立的提交授权。授权失效时，回到监考客户端重新登录；管理员当前 CLI 比赛必须与监考比赛一致。
监考专用凭据与接口说明见 [监考专用登录](PROCTORING_LOGIN.md)。

## 普通队伍网页绑定与提交

在代码文件所在目录直接运行：

```bash
submit A.cpp
```

首次使用时，终端自动打开网页绑定页面：

1. 核对网页和终端显示的设备验证码一致，并确认目标比赛。
2. 在网页输入主办方提供的**比赛队伍用户名和密码**；私有赛还需比赛密码。
3. 点击 **登录并绑定此电脑**，完成后返回终端，核对提交信息并输入 `y` 确认提交。

无需在终端输入比赛编号、用户名或密码。若浏览器没有自动打开，可打开终端显示的绑定链接。
也可以用 `submit login` 提前打开网页完成绑定。

绑定完成后，后续在终端发起提交：

```bash
# 根据文件名选择 A 题，并根据扩展名识别语言
submit A.cpp

# 文件名不对应题号时，明确指定比赛题号
submit --problem A main.cpp
```

每次提交前，终端都会显示文件、网站、比赛、队伍、题号和语言。核对后输入 `y`（或 `Y`）
才会上传代码；输入 `n`、直接回车或结束输入会取消，其他输入会再次提示确认。
命令不提供跳过确认的 `-y` 选项。

提交成功后显示比赛内的提交编号和对应提交记录链接，在网页中查看评测结果。
命令行遵循比赛的账号权限、时间和提交限制。全局账号、虚拟参赛和已绑定监考客户端的账号
不适用于普通网页绑定流程；监考账号使用上面的内网自动绑定方式。

```bash
# 查看本地保存的登录信息
submit status

# 清除本地登录凭据
submit logout
```

普通网页绑定的队伍在管理员切换比赛后，下次运行时会自动打开网页，要求重新绑定新比赛的队伍账号。
重新绑定完成后会再次展示提交信息，仍需输入 `y` 才会提交。
如果比赛在绑定过程中变化，或验证码已过期，请回到终端重新运行命令，使用新的绑定页面。
在公用电脑上完成比赛后，应运行 `submit logout`。

普通网页绑定的配对码有效期为 10 分钟，设备授权有效期为 30 天。设备凭据保存于
`~/.novajudge-submit.json`（Windows 为 `%USERPROFILE%\.novajudge-submit.json`），
文件仅当前用户可读写，不保存队伍密码。
退出时会同时撤销服务端授权；管理员切换或关闭比赛后，旧授权立即失效。

## 更新与卸载

更新时重新运行 `/cli` 页面上的安装命令，已有设备绑定配置会保留。
已安装旧版的用户也需重新运行安装命令，才能使用提交前确认功能。

卸载命令保留本地登录配置；如需清除凭据，请先运行 `submit logout`。
将下方地址替换为实际比赛网站的地址，或直接使用 `/cli` 页面生成的命令：

Windows PowerShell：

```powershell
$installer = Join-Path $env:TEMP 'novajudge-install.ps1'
Invoke-WebRequest -UseBasicParsing 'https://judge.example/api/cli/install?platform=windows' -OutFile $installer
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -Uninstall
```

macOS：

```bash
curl -fsSL 'https://judge.example/api/cli/install' | /bin/bash -s -- --uninstall
```

卸载仅移除本安装器创建的命令和 PATH 条目，保留设备登录配置；安装目录包含其他文件时会拒绝覆盖或删除。
Linux 安装入口尚未提供。

## Windows 监考离线安装

监考客户端可随应用打包 `tools/contestant-cli/` 下的 `install-windows.ps1`、`submit.ps1`、
`submit.cmd`、`submit.bat`。在当前选手 Windows 用户下执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\path\to\bundle\install-windows.ps1' -Url 'http://judge.intranet' -SourceDir 'C:\path\to\bundle'
```

`-SourceDir` 完全使用随包文件，不发起下载，安装和更新均保留用户设备授权。
监考主进程随后按 [监考专用登录](PROCTORING_LOGIN.md) 获取设备令牌并写入当前用户的
`.novajudge-submit.json`。首次安装后应重新打开终端应用，或在启动选手终端时添加安装目录到其 PATH。
公网模式不调用安装/签发流程。退出、结束考试或切换账号时撤销服务器设备授权，并仅移除本客户端拥有且仍匹配的配置。

## 开发验证

从建立监考后台、导入考生、审核登录到真实判题及手机第二机位的完整步骤，见
[Windows 全流程联调手册](WINDOWS_FULL_E2E.md)。配套测试 Compose 和配置模板位于 `docs/windows-e2e/`。

Windows 开发机运行 `npm run test:submit-windows`，验证 PowerShell 客户端、在线与离线安装、更新、
命令解析和卸载。安装器测试使用临时用户目录及 `-NoPathUpdate`，不改开发者的真实用户 PATH 或设备凭据。
`-NoPathUpdate` 仅适合测试或由调用方自行管理 PATH 的场景。

Windows 真实联调使用独立的本机测试数据库（数据库名必须含 `qa` 或 `test`）、Redis、Web 服务和判题 worker。
配置这些进程相同的 `DATABASE_URL`、`REDIS_URL`、`GO_JUDGE_API`，并为测试 Web 服务设置
`NOVAJUDGE_CLI_MODE=intranet` 后，运行
`npm run test:submit-windows:integration`。测试创建自己的比赛、队伍、管理员和随机题目目录，
验证监考授权、确认提交、真实 AC、重登失效、私有赛密码变更、管理员关闭和注销撤销，结束后清理自身数据。
报告保存于 `.local/submit-windows-qa/report.json`。

设置 `PROCTORING_DESKTOP_ROOT` 为监考平台源码根目录，可同时加载真实桌面端
`apps/desktop/src/main/novajudge-submit.ts`，使用随包的离线安装器和真实授权接口验证自动绑定、
退出/结束考试调用的 reset 清理、切换公网撤销。测试只把用户目录和安装目录指向临时位置，
不替换 HTTP 请求或安装逻辑、不改开发者的用户 PATH。该测试覆盖桌面主进程管理器；
发布的 Electron 窗口交互和安装包需在发布验收中检查。

在 macOS 开发机上运行 `npm run test:submit-macos`，验证安装、重复安装、卸载、
登录、参数和提交请求。测试使用临时用户目录，不改开发者的登录和终端配置。
运行 `npm run test:cli-device` 验证设备授权、比赛切换、私有赛和权限边界。
运行 `npm run test:submit-legacy` 验证旧版 Node.js 客户端的地址配置边界。

本地 3001 服务的测试比赛 #2（队伍 `team0001`、A 题为 A+B）处于比赛时间内时，
运行 `npm run test:submit-macos:integration` 可验证从网站下载安装到实际评测的完整流程。
它保留一条真实提交供检查，将报告保存至 `.local/submit-macos-qa/report.json`，
测试完删除临时登录凭据并恢复原比赛配置；设置 `SUBMIT_TEST_KEEP_ACTIVE=1` 可在通过后保留测试赛为当前比赛。
开发测试使用项目现有 Node.js 工具，选手安装的命令本身不依赖 Node.js。

部署此更新时，需要同步新增的数据库表：按项目现有流程运行 `npx prisma db push` 和
`npm run prisma`，然后启动或重启 Web 服务。安装脚本和客户端会随服务端发布，
选手不需要接触数据库或项目运行环境。
