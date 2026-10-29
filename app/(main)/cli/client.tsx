"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { CommandLineIcon } from "@heroicons/react/24/outline";
import CodeBlock from "@/components/CodeBlock";

const subscribe = () => () => {};
const getOrigin = () => window.location.origin;
const getServerOrigin = () => "";
const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
const powershellQuote = (value: string) => `'${value.replace(/'/g, "''")}'`;

export default function CliInstructions() {
  const [contest, setContest] = useState<{ id: number; title: string } | null>(null);
  const [loadingContest, setLoadingContest] = useState(true);
  const [contestError, setContestError] = useState("");
  const origin = useSyncExternalStore(subscribe, getOrigin, getServerOrigin);
  const installer = origin
    ? `curl -fsSL ${shellQuote(`${origin}/api/cli/install`)} | /bin/bash -s --`
    : "";
  const windowsInstaller = origin
    ? `$installer = Join-Path $env:TEMP 'novajudge-install.ps1'\nInvoke-WebRequest -UseBasicParsing ${powershellQuote(`${origin}/api/cli/install?platform=windows`)} -OutFile $installer\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer`
    : "";

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/cli/settings", { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "无法读取当前命令行比赛，请稍后刷新。");
        setContest(data.contest);
      })
      .catch((err: Error) => {
        if (!controller.signal.aborted) setContestError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingContest(false);
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      <header className="bg-white border border-gray-200 shadow-sm rounded-sm p-6">
        <div className="flex items-center gap-3 mb-3">
          <CommandLineIcon className="w-7 h-7 text-blue-600" />
          <h1 className="text-2xl font-serif font-bold text-gray-800">
            submit / printfile 命令行
          </h1>
        </div>
        <p className="text-gray-600 leading-relaxed">
          在自己的 Windows 电脑或 Mac 上安装一次，就能在任意代码目录运行
          <code className="mx-1 text-gray-900">submit A.cpp</code>提交比赛代码。
          Windows 需要 PowerShell 5.1；macOS 支持 Apple Silicon 和 Intel Mac。
          无需安装 Node.js 或 Python。
        </p>
        <div className="mt-4 rounded-sm border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
          {loadingContest ? "正在读取当前命令行比赛…" : contestError ? contestError : contest
            ? <>当前命令行比赛：<strong>#{contest.id} · {contest.title}</strong></>
            : "管理员尚未指定命令行比赛。可以先安装，开始使用前请联系比赛管理员。"}
        </div>
      </header>

      <section className="bg-white border border-gray-200 shadow-sm rounded-sm p-6 space-y-3">
        <h2 className="text-lg font-bold text-gray-800">使用内网监考客户端</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          在支持此功能的 Windows 或 macOS 内网监考客户端登录 NovaJudge 后，客户端会自动安装
          <code className="mx-1">submit</code>和 <code>printfile</code> 并绑定当前队伍，无需再执行下方安装和网页绑定步骤。
          打开新终端即可使用；每次提交仍需输入 <code>y</code> 确认。
          退出监考登录或授权失效后，请回到监考客户端重新登录。外网模式不启用自动安装和绑定。
        </p>
      </section>

      <section className="bg-white border border-gray-200 shadow-sm rounded-sm p-6 space-y-4">
        <h2 className="text-lg font-bold text-gray-800">1. 安装到当前用户</h2>
        <h3 className="font-semibold text-gray-800">Windows（PowerShell 5.1）</h3>
        <p className="text-sm text-gray-600 leading-relaxed">
          Windows 7 需先由机房管理员准备 SP1、.NET Framework 4.5.2 或更高版本，以及 WMF 5.1。
          可运行 <code>$PSVersionTable.PSVersion</code> 确认 PowerShell 版本为 5.1，再执行安装命令。
        </p>
        <p className="text-sm text-gray-600 leading-relaxed">
          打开 Windows PowerShell，以普通用户运行下方命令。安装器将命令放入
          <code className="mx-1">%LOCALAPPDATA%\NovaJudge\submit</code>，并加入当前用户 PATH。
          无需管理员权限；安装后关闭并重新打开终端应用（包括 Windows Terminal 或 VS Code）。
        </p>
        {origin ? <CodeBlock code={`${windowsInstaller} -Url ${powershellQuote(origin)}`} />
          : <p className="text-sm text-gray-500">正在生成当前网站的安装命令…</p>}
        <p className="text-sm text-gray-600">当前 PowerShell 窗口立即使用：</p>
        <CodeBlock code={'$env:Path = "$env:LOCALAPPDATA\\NovaJudge\\submit;$env:Path"'} />
        <h3 className="font-semibold text-gray-800">macOS</h3>
        <p className="text-sm text-gray-600 leading-relaxed">
          打开 macOS「终端」，复制并运行下方命令。安装器会从当前比赛网站下载脚本，
          保存网站地址，并将 <code>submit</code> 和 <code>printfile</code> 安装到 <code>~/.local/bin</code>。
          无需 sudo、克隆仓库或运行 npm。
        </p>
        {origin ? (
          <CodeBlock code={`${installer} --url ${shellQuote(origin)}`} />
        ) : (
          <p className="text-sm text-gray-500">正在生成当前网站的安装命令…</p>
        )}
        <p className="text-sm text-gray-600">
          安装后打开一个新终端；如需在当前终端立即使用，运行：
        </p>
        <CodeBlock code={'export PATH="$HOME/.local/bin:$PATH"'} />
      </section>

      <section className="bg-white border border-gray-200 shadow-sm rounded-sm p-6 space-y-4">
        <h2 className="text-lg font-bold text-gray-800">2. 首次提交时在网页绑定账号</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          在代码目录运行下方命令，终端会自动打开绑定网页。核对网页与终端的设备验证码，
          输入当前比赛的队伍用户名和密码，再点击「登录并绑定此电脑」。私有赛还需填写比赛密码。
          完成后返回终端，核对提交信息并输入 <code>y</code> 确认提交，无需在终端输入比赛编号或账号。
        </p>
        <CodeBlock code="submit A.cpp" />
        <p className="text-sm text-gray-600 leading-relaxed">
          也可以运行 <code>submit login</code> 提前打开网页绑定。
          网页绑定适用于普通比赛队伍账号；全局账号和虚拟参赛不适用，监考账号请使用上方内网客户端自动绑定。
          比赛由管理员统一指定；管理员切换比赛后，客户端会自动要求在网页重新绑定新比赛的队伍账号。
          重新绑定后仍需在终端确认提交。
        </p>
      </section>

      <section className="bg-white border border-gray-200 shadow-sm rounded-sm p-6 space-y-4">
        <h2 className="text-lg font-bold text-gray-800">3. 核对信息并确认提交</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          文件名为题号时会自动选择对应题目，例如 <code>A.cpp</code> 对应 A 题。
          文件名不含题号时，用 <code>--problem</code> 指定比赛中的题号。
          语言根据文件扩展名识别。
        </p>
        <CodeBlock code={"submit A.cpp\nsubmit --problem A main.cpp"} />
        <p className="text-sm text-gray-600 leading-relaxed">
          每次提交前，终端都会显示文件、网站、比赛、队伍、题号和语言。
          核对后输入 <code>y</code>（或 <code>Y</code>）才会上传代码；输入 <code>n</code> 或直接回车取消，
          其他输入会再次提示。提交成功后会显示比赛内的提交编号和对应提交记录链接。
        </p>
        <p className="text-sm text-gray-600">查看本地登录信息或退出登录：</p>
        <CodeBlock code={"submit status\nsubmit logout"} />
      </section>

      <section className="bg-white border border-gray-200 shadow-sm rounded-sm p-6 space-y-4">
        <h2 className="text-lg font-bold text-gray-800">4. 通过监考登录发送打印请求</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          在内网监考客户端登录后，运行 <code>printfile 文件名</code>。终端会先显示比赛、队伍、
          文件名、大小和语言；核对后输入 <code>y</code> 确认，输入 <code>n</code> 或直接回车取消。
          不会输出源码正文。也可以在命令末尾指定 <code>y</code> 或 <code>n</code>，仍会先显示文件信息。
        </p>
        <CodeBlock code={'printfile A.cpp\nprintfile "source file.py" y\nprintfile Main.java n'} />
        <p className="text-sm text-gray-600 leading-relaxed">
          仅支持 UTF-8 编码的 .cpp、.c、.cc、.cxx、.java、.py 文件，最多 120,000 字节和 100,000 个字符。
          成功后会显示打印请求编号，管理员可在当前比赛的打印队列处理。
          普通网页绑定不能使用此命令；监考登录失效后，请返回监考客户端重新登录。
        </p>
      </section>

      <section className="bg-white border border-gray-200 shadow-sm rounded-sm p-6 space-y-4">
        <h2 className="text-lg font-bold text-gray-800">更新与卸载</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          更新时重新运行上方安装命令，已有设备绑定配置会保留。已安装旧版的用户也需更新，才能使用 printfile。
          卸载前可先运行 <code>submit logout</code> 清除本地登录凭据；
          下方卸载命令保留登录配置。
        </p>
        <p className="text-sm text-gray-600">Windows PowerShell：</p>
        {origin && <CodeBlock code={`${windowsInstaller} -Uninstall`} />}
        <p className="text-sm text-gray-600">macOS 终端：</p>
        {origin && <CodeBlock code={`${installer} --uninstall`} />}
        <p className="text-sm text-gray-500">
          Windows 7 需先由管理员安装 SP1、.NET Framework 4.5.2 或更高版本，以及 WMF 5.1；自带 PowerShell 2.0 不能运行当前脚本。
          Linux 安装入口尚未提供。
        </p>
      </section>
    </div>
  );
}
