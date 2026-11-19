"use client";

import { FormEvent, useEffect, useState } from "react";
import { CheckCircleIcon, ComputerDesktopIcon } from "@heroicons/react/24/outline";
import { useLanguage } from "@/context/LanguageContext";
import { formatMessage, getLocale } from "@/lib/dictionaries";

type Approval = {
  userCode: string;
  contest: { id: number; title: string; type: string };
  expiresAt: string;
  status: string;
};

export default function DeviceApproval({ code }: { code: string }) {
  const { dict, lang } = useLanguage();
  const { cliConnect: copy, cliConnectErrors } = dict;
  const [approval, setApproval] = useState<Approval | null>(null);
  const [loading, setLoading] = useState(Boolean(code));
  const [saving, setSaving] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [needsNewRequest, setNeedsNewRequest] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
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
        if (controller.signal.aborted) return;
        if (res.ok) setApproval(data as Approval);
        else setErrorCode(typeof data?.code === "string" ? data.code : "LOOKUP_FAILED");
      })
      .catch(() => {
        if (!controller.signal.aborted) setErrorCode("LOOKUP_FAILED");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [code]);

  const approve = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setErrorCode(null);
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
          setErrorCode(typeof data.code === "string" ? data.code : "APPROVAL_FAILED");
          return;
        }
      }
      setCompleted(true);
      setPassword("");
      setContestPassword("");
    } catch {
      setErrorCode("APPROVAL_FAILED");
    } finally {
      setSaving(false);
    }
  };

  const error = errorCode && (Object.hasOwn(cliConnectErrors, errorCode)
    ? cliConnectErrors[errorCode as keyof typeof cliConnectErrors]
    : approval ? cliConnectErrors.APPROVAL_FAILED : cliConnectErrors.LOOKUP_FAILED);
  const alreadyApproved = approval?.status === "ready";
  const pending = approval?.status === "pending" && !needsNewRequest;

  return (
    <div className="w-full max-w-xl mx-auto bg-white border border-gray-200 shadow-sm rounded-sm p-6 sm:p-8 space-y-6">
      <div className="flex items-center gap-3">
        <ComputerDesktopIcon className="h-7 w-7 text-blue-600" />
        <h1 className="text-2xl font-serif font-bold text-gray-800">{copy.title}</h1>
      </div>

      {loading ? (
        <p className="text-gray-600">{copy.loading}</p>
      ) : completed || alreadyApproved ? (
        <div className="rounded-sm border border-green-200 bg-green-50 p-5 text-green-800 space-y-2">
          <CheckCircleIcon className="h-7 w-7" />
          <h2 className="font-bold">{copy.linked}</h2>
          <p className="text-sm">{copy.returnToTerminal}</p>
        </div>
      ) : approval ? (
        <>
          <div className="space-y-3 rounded-sm border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm text-gray-600">{copy.checkCode}</p>
            <p className="font-mono text-3xl font-bold tracking-widest text-gray-900">{approval.userCode}</p>
            <p className="text-sm text-gray-800">
              {copy.activeContest} · <strong>#{approval.contest.id} · {approval.contest.title}</strong>
            </p>
            <p className="text-xs text-gray-500">
              {formatMessage(copy.expires, { date: new Date(approval.expiresAt).toLocaleString(getLocale(lang)) })}
            </p>
          </div>
          {pending ? (
            <form onSubmit={approve} className="space-y-4">
              <p className="text-sm text-gray-600 leading-relaxed">
                {copy.teamAccountHelp}
              </p>
              <label className="block text-sm font-medium text-gray-700">
                {copy.teamUsername}
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
                {copy.teamPassword}
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
                  {copy.privateContestPassword}
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
                {saving ? copy.linking : copy.link}
              </button>
            </form>
          ) : (
            <p className="text-sm text-amber-700">{copy.invalidRequest}</p>
          )}
        </>
      ) : (
        <p className="text-sm text-gray-600">
          {code ? copy.unavailable : copy.noCode}
        </p>
      )}

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!completed && !alreadyApproved && (
        <p className="text-xs text-gray-500 leading-relaxed">
          {copy.newRequestHelp}
        </p>
      )}
    </div>
  );
}
