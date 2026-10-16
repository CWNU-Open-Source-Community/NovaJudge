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
