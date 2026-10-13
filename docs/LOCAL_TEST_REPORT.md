# 本机部署与真实监考客户端验收

日期：2026-10-12。环境：macOS、Docker Desktop ARM64、Node.js 24、生产构建网页、
项目真实 Electron 监考客户端。NovaJudge 为本机实际 PostgreSQL、Redis、go-judge 和两个
Worker 服务；自动登录、下载、提交与判题没有使用 NovaJudge 模拟接口。

## 结果

- NovaJudge 网页、API、判题与比赛运营：最终汇总 **67 项通过，0 项失败**。
- 真实监考客户端与真实 NovaJudge 联调：**13 项通过，0 项失败**。
- 项目已有单元测试：**55 项通过**。
- 两轮通信题真实沙箱测试：**13 项通过**；编译缓存真实多进程测试：**3 项通过**。
- 两个项目的生产网页构建、监考客户端构建和监考项目全工作区类型检查通过。

功能验收是下面列出的具体场景，不代表已经穷尽所有输入、硬件、平台和安全风险。

## 第二机位代码检查（未实测）

按用户后续要求，仅检查代码，没有运行手机第二机位测试。

- NovaJudge 考试保留 `requireMiniProgram` 配置，考室的 `requireSecondCamera` 优先决定实际要求。
- 手机配对/重连签发独立手机会话令牌；`MOBILE_CAMERA` 的 WHIP 推流、媒体服务授权、
  心跳、断线处理、录像上传及监考端播放未按 Hydro 平台限制。
- NovaJudge 的浏览器访问限制仅约束桌面内置答题页面，不阻止独立手机第二机位连接监考服务。
- 检查发现：已登录手机在考室暂不要求第二机位时停止心跳，后续开启要求无法自动收到新配置。
  已修复为在有效监考会话中持续心跳，收到新配置后按既有逻辑启动摄像头和推流，考试结束后停止。
  对应文件：`proctoring-platform/apps/client-web/src/components/CandidateApp.tsx`。
- 手机摄像头持续采集要求手机页面使用 HTTPS，手机还需要能够访问监考服务与媒体服务的网络地址。
  当前本机 HTTP 演示不等于已完成手机 HTTPS 部署；此处结论为代码检查结果。
- 桌面 `config.js` 的 `PROCTOR_MOBILE_WEB_URL` 和 `PROCTOR_PUBLIC_API_URL` 应指向手机可访问的
  监考 HTTPS 入口。当前开发默认值为 `https://192.168.1.159:3443`，后续部署需按实际地址设置；
  第二机位连接监考系统，而不是 NovaJudge 域名。

## NovaJudge 验收范围

| 功能 | 验证方式 | 结果 |
| --- | --- | --- |
| 管理员、比赛账号登录 | 浏览器与真实 HTTP 请求；错误密码、匿名管理 API、Cookie 身份、退出登录 | 通过 |
| 比赛管理 | 创建、编辑、公私有设置、显示隐藏、删除、ZIP 导出与导入回环、Worker 自动开始比赛 | 通过 |
| 题库 | 浏览器创建题目、样例、测试数据 ZIP/YAML、绑定比赛、附件上传下载、导入导出 | 通过 |
| 选手与工作人员 | TEAM、JUDGE、BALLOON、PRINT、OBSERVER、ADMIN 导入；比赛与角色权限 | 通过 |
| 标准判题 | C、C++、Java、PyPy3 正确程序均 AC；WA、CE、RE、TLE、MLE 实际程序 | 通过 |
| 其他题型 | SPJ、交互题、两轮通信题的正确与错误程序；通信题样例调试 | 通过 |
| 判题调度 | 两个 Worker 真实处理任务、8 条并发提交、重复入队、单条与批量重测、进度/SSE | 通过 |
| 榜单、奖项 | 解题榜、导出、封榜与解榜权限、奖牌与自定义奖项保存 | 通过 |
| 答疑和公告 | 私有提问、裁判回复、公开公告、其他队私有详情/回复拒绝 | 通过 |
| 打印 | 提交打印申请、工作人员打印页面、失败/打印完成状态、非法文件类型拒绝 | 软件流程通过 |
| 气球 | 生成、同队同题去重、指派、工作人员送达、匿名送达拒绝 | 通过 |
| 外部接口 | API Key 创建/启停/无效 Key；题目与提交的状态、时间、内存、代码；CCS 接口与事件流 | 通过 |
| 训练与虚拟参赛 | 目录创建/编辑/删除；开始、重开虚拟参赛及真实判题 | 通过 |
| 自动登录 | CLI 登录与比赛上下文、IP 绑定登录与无绑定回退 | 通过 |
| 提交边界 | 比赛开始前拒绝、跨比赛网页提交拒绝、普通队伍不能操作后台 | 通过 |

## 真实监考客户端验收

1. 读取本机真实屏幕、摄像头与辅助控制权限，并发现桌面源。
2. 在客户端填写考号密码，连接真实监考后台；管理员审核后客户端收到批准状态。
3. 点击开始考试，后台使用对应比赛的考号密码登录真实 NovaJudge；客户端安装 HttpOnly
   登录 Cookie，直接进入 `/contest/2`，显示 NovaJudge 比赛页面。
4. 在内置浏览器浏览真实题面，下载 NovaJudge 真实附件并核对文件内容。
5. 尝试外部页面、图片、请求和弹窗；本机外部测试站点收到 **0 个请求**。其他比赛地址
   被阻止，客户端回到当前比赛。
6. 在真实 Monaco 编辑器填写 C++，点击提交；按此次独有代码标记从 NovaJudge 确认该提交 AC。
7. 使用本机真实屏幕和前置摄像头推流；媒体服务两条流均在线且收到数据，监考后台确认在线。
8. 后台上传并下发控屏图片；真实客户端展示控屏，后台停止后客户端解除。
9. 从客户端上报异常，模拟 USB 指纹变化触发锁定；真实客户端响应锁定并在管理员解锁后恢复。
10. 从真实 NovaJudge 读取题目、提交，经监考外榜转换后推送到本机接收端，核对 AC 记录。
11. 故意配置错误 NovaJudge 密码，验证失败提示；恢复正确密码，点击重试后登录成功。
12. 核对数据库中已实际保存屏幕与摄像头录像片段。
13. 在客户端确认结束考试，核对后台 FINISHED 状态与 NovaJudge Cookie 清理。

监考使用的考室和考生来自真实测试后台。本次测试开启屏幕、前置摄像头与录像保存；
第二机位未开启。监考客户端没有显示监考后台的侧边导航，保留了浏览器工具栏、考试计时
与监控预览。

## 本次修复

- 本机 ARM 判题镜像软件下载与根证书配置；固定可用 go-judge 版本，消除沙箱 HTTP 500。
- 交互题没有标准答案文件时被误判为数据缺失。
- 比赛开始前与跨比赛提交的服务端校验。
- 私有答疑回复及跨比赛答疑权限、匿名气球送达权限。
- NovaJudge 管理后台“Sign Out”按钮接入真实退出接口。
- 监考客户端登录等待/重试界面被监控预览遮挡；等待期间只隐藏预览，采集和推流继续。
- 录像上传与心跳并发时的数据库事务冲突；只重试回滚的数据库操作，文件保持幂等保存。

修复前失败的测试提交保留在验收比赛中，历史 System Error 不代表修复后仍然失败。

## 尚未验证或需要另行处理

- 实体打印机纸张输出、现场气球配送、手机第二机位和真实 USB 拔插。
- Windows、其他 macOS 版本、长时间稳定性与高并发压测。
- 公网 HTTPS、远程 NovaJudge 部署、正式 CWNUPAA 外榜接收：本次外榜来源为真实 NovaJudge，
  接收端为本机测试服务，没有向正式赛事发送测试数据。
- 原依赖安全检查报告 **47 项告警（含 Next.js 1 项 critical）**。本次为本机部署；正式联网
  部署前应升级受影响依赖并重新验收。
- 源码 lint 仍报告原 `benchmark.ts` 中 1 个 `any` 类型错误和 1 个未使用变量警告；生产构建通过。

## 访问与证据

- NovaJudge：[http://localhost:3001](http://localhost:3001)。
- 本机监考演示后台：[http://127.0.0.1:43218](http://127.0.0.1:43218)。
- 两套后台和考生账号：本机私有文件 `.local/本机访问账号.md`。
- NovaJudge 最终明细：`.local/reports/final-functional-tests.json`。
- 监考客户端明细：`/Users/jiangys/Jiangys/Program/proctoring-platform/tmp/novajudge-live/reports/client-tests.json`。
- 自动登录与提交截图：上述目录中的 `auto-login.png`、`submission.png`。
- 本机监考演示服务可用以下独立工具启停，数据保留：

```sh
node /Users/jiangys/Jiangys/Program/proctoring-platform/tmp/novajudge-live/service.mjs status
node /Users/jiangys/Jiangys/Program/proctoring-platform/tmp/novajudge-live/service.mjs start
node /Users/jiangys/Jiangys/Program/proctoring-platform/tmp/novajudge-live/service.mjs stop
```

NovaJudge 启停和数据位置见 [本机部署说明](LOCAL_DEPLOYMENT.md)。
