# 监考专用登录

监考后台通过 `POST /api/cli/login` 提交指定比赛的账号、密码和
`loginSource: "PROCTORING"`，并在 `x-api-key` 请求头提供启用的超级管理员 API Key。
该入口仅允许比赛 `TEAM` 账号建立监考登录；普通浏览器不能只靠一个固定标记建立此状态。

私有赛还必须在请求体提供独立的 `contestPassword`。比赛账号密码、监考管理员 API Key
和比赛密码分别校验，只有全部通过才会建立或更新监考绑定；缺少或错误的比赛密码返回
`403` 和 `code: "CONTEST_PASSWORD_REQUIRED"`。公开赛无需填写 `contestPassword`。

成功登录返回带有 `loginSource`、`proctoringKeyHash` 字段的 JWT，以及随机生成的
`proctoringKey`。数据库比赛用户同时保存 `proctoringKeyHash` 和 `proctoringLoginAt`。
随机凭据只返回给监考后台一次，不写入 URL；数据库不保存明文凭据。

监考桌面客户端将 JWT 写入 HttpOnly Cookie，并在主进程内保存随机凭据。
仅对配置的 NovaJudge 平台域名注入 `x-novajudge-proctor-key`，包含页面、接口及附件下载。
服务器同时核对 JWT、数据库当前绑定和请求头中的凭据。

私有赛登录同时返回 `contestAccessToken`，客户端必须保留该凭据：

- 页面、接口和附件请求：将其写入名为 `contest_access_<contestId>` 的 HttpOnly Cookie，
  `Path=/`、`SameSite=Lax`，HTTPS 部署启用 `Secure`，有效期不超过 24 小时。
- CLI 请求：除 `Authorization: Bearer <token>` 和原有监考请求头外，
  还应发送 `x-contest-access-token: <contestAccessToken>`。

此凭据仅对指定比赛及当前比赛密码有效，修改比赛密码后必须重新登录获取。
监考凭据和比赛授权凭据不可互相替代；不要把任何凭据写入 URL 或日志。
退出登录会清除比赛授权 Cookie，但不会解除服务器保存的监考绑定。

账号被监考登录绑定后：

- 网页账号密码登录、普通 CLI 登录及 IP 自动登录被拒绝。
- 以前的普通网页登录态立即失效，复制监考 Cookie 到普通浏览器也无法访问。
- 再次通过监考客户端登录会替换绑定，之前的监考 JWT 和随机凭据失效。
- 其他未绑定的比赛账号保持原有登录方式；全局超级管理员登录与管理功能正常。
- 绑定属于该场比赛的账号，客户端退出、注销或考试结束不会自动恢复普通浏览器登录。

## 内网自动绑定 submit 协议

NovaJudge Web 服务默认关闭 submit。内网部署必须显式设置 `NOVAJUDGE_CLI_MODE=intranet`
并重启服务，再由管理员选定当前 CLI 比赛。公网部署保持变量未设置或 `public`；
即使客户端直接调用设备签发或提交接口，也会收到 `403 / CLI_DISABLED`。
这个开关不关闭上文的监考登录接口，公网监考客户端仍可登录并使用网页提交。

监考桌面客户端仅在运行时选择 **intranet 内网后台**、使用 Windows 或 macOS 且登录 NovaJudge 考试时，
安装内置的原生 `submit` 并获取专用提交授权。公网模式不安装、不签发；从内网切换到公网时，
撤销并清理本客户端此前建立的提交授权。安装不需要访问互联网或安装额外运行时。

监考登录成功后，桌面主进程调用 `POST /api/cli/device/proctoring`，请求体为 `{}`，请求头为：

- `Authorization: Bearer <监考登录 JWT>`
- `x-novajudge-proctor-key: <监考登录返回的随机凭据>`
- 私有赛另加 `x-contest-access-token: <已有比赛授权>`

服务端验证当前监考绑定及 TEAM 身份，要求登录比赛等于管理员指定的当前 CLI 比赛。
未启用返回 `CLI_DISABLED`，不匹配返回 `CONTEST_CHANGED`，不自动改变管理员配置。
成功响应包含 `deviceToken`、`loginSource: "PROCTORING"`、`contest`、`user`、`expiresAt`。
客户端加上 `baseUrl`，原子写入 `~/.novajudge-submit.json`，权限为 `0600`。
该文件只包含专用提交授权，不保存账号密码、管理员 API Key、监考 JWT 或监考随机凭据。

`submit A.cpp` 会直接显示当前队伍及比赛，输入 `y` 后提交，无需再次打开浏览器绑定。
授权期限不超过监考登录 JWT 和已有私有赛授权；再次监考登录、管理员切换比赛、
修改私有赛密码会使旧授权失效。监考客户端退出、注销、结束考试或切换账号时，通过
`DELETE /api/cli/device` 携带提交令牌撤销授权，并仅移除自己创建且仍匹配的本地配置。
失效的监考授权提示回到监考客户端恢复，不进入普通浏览器配对流程。

### Windows 监考客户端接入

Windows 使用同一设备授权协议，由内置 Windows PowerShell 5.1 运行 `submit.ps1`，
`submit.cmd` / `submit.bat` 提供 CMD、PowerShell 和编辑器终端的统一入口。
选手电脑不需要安装 Node.js、Python 或申请管理员权限。以下步骤是监考客户端的接入要求；
仅部署 NovaJudge 服务端和选手脚本不会自动升级已安装的监考客户端。

1. 将 `tools/contestant-cli` 下的 `install-windows.ps1`、`submit.ps1`、`submit.cmd`
   和 `submit.bat` 放入监考应用的资源目录，发布时随安装包一起携带。
2. 仅在运行时选择 `intranet` 内网后台且已取得有效 NovaJudge 监考登录时，
   主进程用 `execFile` / 参数数组启动下方安装命令。设置隐藏窗口，检查退出码。
   路径和网站地址分别作为参数传递，不拼成 `cmd /c` 命令串，不把登录凭据放进参数。
3. 主进程携带监考 JWT、随机凭据和可选私有赛授权调用上述
   `POST /api/cli/device/proctoring`；服务端拒绝时保留错误信息供用户处理，
   不回退普通网页配对，也不更改管理员选定的比赛。如果先取得授权再安装，安装失败必须撤销已签发的令牌。
4. 将返回字段与 `baseUrl` 写入当前交互用户的
   `%USERPROFILE%\.novajudge-submit.json`。使用 UTF-8 无 BOM、同目录临时文件和原子替换。
   Windows 不能依赖 `chmod(0600)` 保护文件：临时文件在写入令牌前就应关闭 ACL 继承，
   仅授予当前用户 SID 读写权限，并保留必要的系统管理权限；目标配置也应受相同 ACL 保护。
   不以管理员或系统账号的用户目录代替实际参赛者目录。Windows 监考程序同账号 UAC 提升可正常使用；
   如果用其他管理员账号授权，准备阶段应拒绝写入错误账号目录并提示使用同一账号。
5. 记录本次创建的 `deviceToken` 和 `baseUrl`，退出、注销、考试结束、切换账号或
   从内网切换到公网时撤销该令牌。删除本地配置前重新读取，只有令牌和网站均仍匹配
   本次授权时才删除，避免清理掉后来建立的新登录。服务端撤销请求失败时仍应清理匹配的
   本地凭据并明确提示撤销尚未成功；下次可重试撤销，但不要记录令牌内容。

```powershell
# 由监考主进程调用；SourceDir 必须是随安装包发布的可信资源目录。
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\path\install-windows.ps1" -Url "http://judge.example" -SourceDir "C:\path\contestant-cli"
```

安装器默认安装到 `%LOCALAPPDATA%\NovaJudge\submit`，保存 `submit-defaults.json` 并更新
当前用户 PATH。已有终端需要重新打开。监考客户端若立即启动终端，应在该子进程的 `env.PATH`
中加入安装目录，不要修改系统 PATH。`-NoPathUpdate` 适用于隔离测试或由监考客户端统一管理
子进程环境的部署；普通安装不应使用此选项。

自动绑定后的配置示意如下（实际令牌只通过响应体和受保护的本地文件传递）：

```json
{
  "baseUrl": "http://judge.example",
  "deviceToken": "njcli_<server-issued-token>",
  "loginSource": "PROCTORING",
  "contest": { "id": 2, "title": "示例比赛" },
  "user": { "username": "team0001", "displayName": "示例队伍" },
  "expiresAt": "<server-issued-expiration>"
}
```

Windows `submit A.cpp` 先用设备令牌校验当前授权，再显示队伍、比赛、文件、题号及语言，
输入 `y` 才调用 `/api/cli/device/submit`。`loginSource: "PROCTORING"` 的授权过期、
撤销或不再匹配监考绑定时，脚本提示回到监考客户端恢复，禁止自动切换到普通浏览器登录。

联调应分别验证：内网自动安装和绑定、确认/取消提交、私有赛授权、再次监考登录使旧授权失效、
管理员关闭或切换比赛、注销及内网切公网清理，以及公网模式不安装、不签发提交授权。
接口与脚本测试只能确认协议及命令行为；自动安装和生命周期清理还须用对应监考应用版本验证。

自动授权另需部署 `20261028000000_cli_devices` 和 `20261028010000_cli_proctoring_devices`
两个迁移中的表及字段，然后重新生成 Prisma Client。普通网页配对仍只支持未绑定监考的队伍。

升级需增加 `prisma/migrations/20261013000000_proctored_logins/migration.sql` 中的两个可空字段，
生成 Prisma Client、重新构建并重启 NovaJudge；已有用户初始均未绑定。
项目原有 `prisma db push` 部署方式同样可以添加这些字段。

验证命令：

```sh
npx tsx --test lib/proctoring-access.test.ts
npm run test:contest-access
npx tsx scripts/test-proctoring-login.ts
```

后一命令只允许本机 5433 端口的隔离部署，使用 `.local/access.json` 中的本机 API Key，
创建并清理自己的验收比赛和用户，覆盖旧 Cookie、复制 Cookie、错误标记、IP 登录及重新绑定。
