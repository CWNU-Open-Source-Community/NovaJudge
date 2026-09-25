# 通信题：同一程序运行两次

NovaJudge 的 `communication` 题型用于两轮普通标准输入输出的通信题：第一次运行输出一条受限制的消息，裁判验证并转换消息，然后在全新的运行环境中第二次执行同一份选手程序。第二轮不能读取第一轮的变量、文件或原始输入，只能获得裁判生成的第二轮输入。

Codeforces 的 [通信题公告](https://codeforces.com/blog/entry/147996)采用相同的 run-twice 定义，并说明两轮时间、内存限制分别计算。通信与实时交互是不同概念，也可以组合；本次实现支持普通两轮通信，不支持在任意一轮与裁判实时交互。

## 题包与配置

新建题目时选择 `Communication (Run twice)`，编辑器会自动生成七个题面 section：`Problem Description`、`First Run`、`Input`、`Output`、`Second Run`、`Input`、`Output`，并预填编码 / 解码示例的说明和 `first` / `second` 输入格式。可直接按题意修改。新建时切换题型会保留各自的题面草稿；编辑已保存的题目不会自动替换题面。

新建题目并选择「通信题」，将以下文件放在同一个 ZIP 根目录后上传到测试数据：

```text
problem.yml
communicator.cpp
1.in
2.in
```

`problem.yml` 示例：

```yaml
type: communication
communicator: communicator.cpp
communication:
  output_limit: 1048576
cases:
  - input: 1.in
    output: /dev/null
  - input: 2.in
    output: /dev/null
```

- `communicator`：题目作者编写的 C++ 通信裁判源码，平台以 C++23 编译并提供 `testlib.h`。
- `communication.output_limit`：每轮选手 stdout 的字节上限，默认 1048576（1 MiB），可配置范围为 1 到 16777216（16 MiB），两轮分别限制。超过限制会因违反通信输出约束而判 WA。
- `cases[].input`：第一轮完整原始输入。如果题目通过 `first` 标识阶段，文件本身必须包含 `first`，平台不会自动添加。
- `cases[].output`：供裁判使用的参考答案文件；不需要时使用 `/dev/null`，裁判会获得一个空 `answer.out`。

题包内文件使用相对路径。编码消息的字符集、长度、允许修改的内容等题目规则由通信裁判检查；不能仅依赖系统输出字节限制。

现成示例见 [字母信使](../examples/communication/encode-decode/README.md)，包含通信裁判、正确解、错误解及两个测试点。

## 一次测试点的执行过程

```text
第一轮原始输入
      ↓
选手程序，第 1 次运行
      ↓ 第一轮输出
通信裁判 prepare：验证消息，生成第二轮输入
      ↓ 仅传递 prepare 的 stdout
同一选手程序，第 2 次运行（全新环境）
      ↓ 第二轮输出
通信裁判 check：验证最终结果
      ↓
最终判定
```

选手程序只编译一次，两轮使用同一编译产物，但进程和可写文件系统互相隔离。第一轮运行异常或 `prepare` 拒绝消息时，后续阶段不会继续。

每轮都独立应用题目时间、内存限制。例如时间限制为 2 秒时，两轮分别使用 1.5 秒可以通过；不会因为两轮合计 3 秒而判 TLE。提交汇总展示两轮最大用时和最大内存，不把裁判开销计入选手资源统计。

## 通信裁判接口

同一个裁判程序会被离线调用两次：

```text
./communicator input.in user.out answer.out prepare
./communicator input.in user.out answer.out check
```

裁判应先保存 `argv[4]` 的模式，再调用 `registerTestlibCmd(4, argv)`。不能把完整的 5 个参数直接交给 testlib，否则 `prepare` 或 `check` 会被理解为报告文件名。testlib 的命令行参数约定见 [官方源码](https://github.com/MikeMirzayanov/testlib/blob/master/testlib.h)。

```cpp
if (argc != 5) return 3;
std::string mode = argv[4];
registerTestlibCmd(4, argv);
```

### prepare：验证并生成第二轮输入

| 数据 | 读取方式 |
| --- | --- |
| 第一轮原始输入 `input.in` | `inf` |
| 第一轮选手输出 `user.out` | `ouf` |
| 参考答案 `answer.out` | `ans` |

裁判应先读取并验证第一轮消息，再向 stdout 写出**第二轮完整输入**。如果题目使用 `second` 标识阶段，这个标识也由裁判写出。调用 `quitf(_ok, ...)` 后继续第二轮；`_wa`、`_pe` 或 `_fail` 会提前结束本测试点。

裁判可通过普通文件 API 写入可选 `state.txt`，保存第二轮检查需要的私有状态。该文件上限为 1 MiB，仅会提供给 `check`。不要把私有状态写到 stdout，stdout 的全部内容都会交给第二轮选手。生成的第二轮输入上限为 16 MiB。

### check：验证第二轮输出

| 数据 | 读取方式 |
| --- | --- |
| 第一轮原始输入 `input.in` | `inf` |
| 第二轮选手输出 `user.out` | `ouf` |
| 参考答案 `answer.out` | `ans` |
| 第一轮选手输出 `first.out` | 普通文件 API，如 `std::ifstream` |
| 第二轮完整输入 `second.in` | 普通文件 API |
| prepare 保存的 `state.txt`（可选） | 普通文件 API，使用前检查文件是否存在 |

以上额外文件只提供给裁判，不复制到第二轮选手的沙箱。裁判可以从 `inf` 重新读取原始数据，也可以使用 `state.txt` 保存的转换信息，最终通过 `quitf` 返回判定。

本题型使用 `registerTestlibCmd` 的离线检查协议，使用 stdout 生成第二轮输入，不使用 `registerInteraction`、`tout` 或实时管道。此接口是 NovaJudge 的题包约定，**并不直接兼容 Polygon 通信题包**；导入其他平台的题目需要适配通信裁判。

## 判定与限制

选手的编译、运行异常分别判为 CE、TLE、MLE 或 RE。任意一轮超过通信输出字节限制时判 WA。题目裁判的编译或运行故障属于系统/题目配置错误，不应记为选手 CE。

通信裁判采用 testlib 默认退出码：

| 退出码 | testlib 结果 | 平台判定 |
| --- | --- | --- |
| 0 | `_ok` | prepare 继续；check 为 AC |
| 1 | `_wa` | WA |
| 2 | `_pe` | PE |
| 3 | `_fail` | SE |
| 8 | `_unexpected_eof`（启用专用退出码时） | WA |
| 其他 | 不支持的结果或异常 | SE |

本次不支持部分分数协议或自定义 testlib 退出码。`prepare` 写出的第二轮输入、私有状态及裁判自身的资源消耗也受到限制，超限属于裁判错误。

如果题目约束消息只能包含小写字母，裁判必须拒绝其他字符及多余 token；如果题目要求转化后的顺序变化或消息受扰动，裁判应完成这些转换，再构造第二轮输入。不能无条件透传第一轮输出，否则可能允许超出题意的信息传递。

## 样例与调试

一个样例对应同一个测试点的两轮执行。在题目编辑器选择「通信题」后，为每个样例填写成对的「第一轮输入」「第一轮输出」「第二轮输入」「第二轮输出」。题面按两轮分别展示这四项；不要把第二轮单独添加成另一个样例。

以「字母信使」为例，四个公开字段可以这样填写。

第一轮输入：

```text
first
5
1 2 3 4 5
```

第一轮输出：

```text
abcde
```

第二轮输入：

```text
second
abcde
```

第二轮输出：

```text
5
1 2 3 4 5
```

`first` 和 `second` 是本例约定的输入内容，用于让同一份选手程序识别本次运行的阶段，不是后台字段名，也不是平台自动插入的标记。第一轮输入需要自行填写 `first`；实际判题时的 `second` 由通信裁判生成。其他题目也可以约定不同的阶段标识，但题面、测试数据、选手程序和裁判必须一致。

编辑器另有可选的「裁判参考答案」字段，仅供管理员和通信裁判使用，不在公开题面展示，也不等于第一轮或第二轮的样例输出。本例的裁判直接根据原始输入检查还原出的数组，不读取参考答案，因此留空即可。

管理员执行样例调试时，平台以填写的**第一轮输入**启动选手程序，再将其**实际第一轮输出**交给裁判生成真正的第二轮输入，最后由裁判判定第二轮结果。填写的第一轮输出、第二轮输入和第二轮输出用于展示一种合法过程，不作为固定运行数据或逐字比较的标准答案；合法的另一种编码同样可以通过。调试结果中可以查看本次真实的中间数据。

样例在数据中保持以下结构：

```json
{
  "input": "first\n5\n1 2 3 4 5\n",
  "output": "",
  "communication": {
    "firstOutput": "abcde\n",
    "secondInput": "second\nabcde\n",
    "secondOutput": "5\n1 2 3 4 5\n"
  }
}
```

其中 `output` 为私有裁判参考答案，四个公开展示字段为 `input` 和 `communication` 内的三项。旧通信题样例的 `input`、`output` 保持原意，无需数据库迁移；缺少的公开展示字段留空，编辑题目后可以补齐。完整数组示例见 [samples.json](../examples/communication/encode-decode/samples.json)，该文件供参考，不会随测试数据 ZIP 自动导入样例。

调试时重点检查阶段标识、消息限制以及第二轮是否依赖了已经丢失的状态。正式判题诊断应避免泄露原始隐藏输入、标准答案、私有状态或完整中间数据。

## 参考资料

- [Codeforces 通信题公告](https://codeforces.com/blog/entry/147996)：run-twice 定义及每轮独立限制。
- [Codeforces 2168A1 — Encode and Decode](https://codeforces.com/problemset/problem/2168/A1)：编码字符串后在新进程中解码的例题。
- [Codeforces 2168C — Intercepting Butterflies](https://codeforces.com/problemset/problem/2168/C)：评测器会在两轮之间转换通信消息，说明第二轮输入不一定等于第一轮输出。
- [go-judge 官方 API](https://github.com/criyle/go-judge-doc/blob/master/src/cn/api.md)：独立程序执行、资源限制、文件传入传出及缓存管理；NovaJudge 在其上串行组织两轮执行。
