"use client";

import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

type CliSettingsData = {
  activeContestId: number | null;
  contests: { id: number; title: string; status: string; type: string }[];
};

export default function CliSettings() {
  const [settings, setSettings] = useState<CliSettingsData | null>(null);
  const [selectedContest, setSelectedContest] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/cli-settings", { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "无法加载命令行设置。");
        return data as CliSettingsData;
      })
      .then((data) => {
        setSettings(data);
        setSelectedContest(data.activeContestId?.toString() ?? "");
      })
      .catch((err: Error) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/cli-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activeContestId: selectedContest ? Number(selectedContest) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "无法保存命令行设置。");
      setSettings((current) => current && { ...current, activeContestId: data.activeContestId });
      setSelectedContest(data.activeContestId?.toString() ?? "");
      toast.success("命令行比赛设置已生效");
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法保存命令行设置。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="rounded-lg bg-white p-6 shadow">
      <div className="border-b border-gray-200 pb-5">
        <h2 className="text-lg font-medium text-gray-900">submit 命令行比赛</h2>
        <p className="mt-2 text-sm text-gray-500 leading-relaxed">
          为全站命令行选手指定当前比赛。选手首次提交时会打开网页，登录该比赛的队伍账号并绑定电脑。
          保存后立即生效，无需重启服务。
        </p>
      </div>
      {loading ? (
        <p className="mt-6 text-sm text-gray-500">正在加载比赛…</p>
      ) : settings ? (
        <div className="mt-6 space-y-3">
          <label htmlFor="cli-contest" className="block text-sm font-medium text-gray-900">
            当前比赛
          </label>
          <select
            id="cli-contest"
            value={selectedContest}
            onChange={(event) => setSelectedContest(event.target.value)}
            disabled={saving}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            <option value="">关闭命令行提交</option>
            {settings.contests.map((contest) => (
              <option key={contest.id} value={contest.id}>
                #{contest.id} · {contest.title} · {contest.status} · {contest.type === "PRIVATE" ? "私有赛" : "公开赛"}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 leading-relaxed">
            切换比赛后，选手下次使用命令行时会打开网页，重新绑定新比赛的队伍账号。
            关闭后命令行不再接受提交，网页提交仍按原有比赛规则进行。
          </p>
        </div>
      ) : null}
      {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
      <div className="mt-6 flex justify-end">
        <button
          type="submit"
          disabled={loading || saving || !settings}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "保存中…" : "保存命令行设置"}
        </button>
      </div>
    </form>
  );
}
