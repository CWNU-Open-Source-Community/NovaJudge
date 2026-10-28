"use client";

import { FormEvent, useEffect, useState } from "react";
import { CheckCircleIcon, ComputerDesktopIcon } from "@heroicons/react/24/outline";

type Approval = {
  userCode: string;
  contest: { id: number; title: string; type: string };
  expiresAt: string;
  status: string;
};

export default function DeviceApproval({ code }: { code: string }) {
  const [approval, setApproval] = useState<Approval | null>(null);
  const [loading, setLoading] = useState(Boolean(code));
  const [saving, setSaving] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [needsNewRequest, setNeedsNewRequest] = useState(false);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [contestPassword, setContestPassword] = useState("");

  useEffect(() => {
    if (!code) return;
    const controller = new AbortController();
    fetch(`/api/cli/device/approval?code=${encodeURIComponent(code)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "无法读取此绑定请求。");
        return data as Approval;
      })
      .then(setApproval)
      .catch((err: Error) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [code]);

  const approve = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/cli/device/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          username,
          password,
          ...(approval?.contest.type === "PRIVATE" ? { contestPassword } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (["CONTEST_CHANGED", "CLI_DISABLED", "DEVICE_EXPIRED"].includes(data.code)) {
          setNeedsNewRequest(true);
          setPassword("");
          setContestPassword("");
        }
        if (data.code !== "ALREADY_APPROVED") {
          throw new Error(data.error || "绑定失败，请检查账号信息后重试。");
        }
      }
      setCompleted(true);
      setPassword("");
      setContestPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "绑定失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  };

  const alreadyApproved = approval?.status === "ready";
  const pending = approval?.status === "pending" && !needsNewRequest;

  return (
    <div className="w-full max-w-xl mx-auto bg-white border border-gray-200 shadow-sm rounded-sm p-6 sm:p-8 space-y-6">
      <div className="flex items-center gap-3">
        <ComputerDesktopIcon className="h-7 w-7 text-blue-600" />
        <h1 className="text-2xl font-serif font-bold text-gray-800">绑定 submit 命令行</h1>
      </div>

      {loading ? (
        <p className="text-gray-600">正在读取绑定请求…</p>
      ) : completed || alreadyApproved ? (
        <div className="rounded-sm border border-green-200 bg-green-50 p-5 text-green-800 space-y-2">
          <CheckCircleIcon className="h-7 w-7" />
          <h2 className="font-bold">已完成绑定</h2>
          <p className="text-sm">请返回终端继续。现在可以关闭此页面。</p>
        </div>
      ) : approval ? (
        <>
          <div className="space-y-3 rounded-sm border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm text-gray-600">确认下方验证码与正在使用的终端一致：</p>
            <p className="font-mono text-3xl font-bold tracking-widest text-gray-900">{approval.userCode}</p>
            <p className="text-sm text-gray-800">
              当前比赛：<strong>#{approval.contest.id} · {approval.contest.title}</strong>
            </p>
            <p className="text-xs text-gray-500">
              有效期至 {new Date(approval.expiresAt).toLocaleString()}
            </p>
          </div>
          {pending ? (
            <form onSubmit={approve} className="space-y-4">
              <p className="text-sm text-gray-600 leading-relaxed">
                输入此比赛的队伍账号，将登录状态保存到发起请求的电脑。
                全局账号、虚拟参赛及已绑定监考客户端的账号不适用。
              </p>
              <label className="block text-sm font-medium text-gray-700">
                队伍用户名
                <input
                  required
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  disabled={saving}
                  className="mt-2 block w-full rounded-sm border border-gray-300 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                队伍密码
                <input
                  required
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={saving}
                  className="mt-2 block w-full rounded-sm border border-gray-300 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              {approval.contest.type === "PRIVATE" && (
                <label className="block text-sm font-medium text-gray-700">
                  私有赛比赛密码
                  <input
                    required
                    type="password"
                    autoComplete="off"
                    value={contestPassword}
                    onChange={(event) => setContestPassword(event.target.value)}
                    disabled={saving}
                    className="mt-2 block w-full rounded-sm border border-gray-300 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </label>
              )}
              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-sm bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "正在绑定…" : "登录并绑定此电脑"}
              </button>
            </form>
          ) : (
            <p className="text-sm text-amber-700">此绑定请求已失效，请回到终端重新运行 submit。</p>
          )}
        </>
      ) : (
        <p className="text-sm text-gray-600">
          {code ? "此绑定请求无法使用。" : "链接缺少设备验证码。"}请回到终端重新运行 submit。
        </p>
      )}

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!completed && !alreadyApproved && (
        <p className="text-xs text-gray-500 leading-relaxed">
          如果管理员已切换比赛，或验证码已过期，请回到终端重新运行 submit，使用新打开的绑定页面。
        </p>
      )}
    </div>
  );
}
