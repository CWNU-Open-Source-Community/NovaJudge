"use client";

import { useId, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ContestSubmissionFilters as Filters } from "@/lib/contest-rejudge-types";

export type TeamOption = {
  id: string;
  username: string;
  displayName: string | null;
  school: string | null;
  seat: string | null;
};

const inputClass = "mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

function teamLabel(team: TeamOption) {
  return [team.displayName || team.username, team.username, team.school, team.seat && `座位 ${team.seat}`].filter(Boolean).join(" · ");
}

function localTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() + 8 * 60 * 60_000).toISOString().slice(0, 19);
}

export default function ContestSubmissionFilters({ filters, teams, problems, languages, verdicts, languageRecord, verdictRecord }: {
  filters: Filters;
  teams: TeamOption[];
  problems: { displayId: string; title: string }[];
  languages: string[];
  verdicts: string[];
  languageRecord: Record<string, string>;
  verdictRecord: Record<string, string>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const listId = useId();
  const [pending, startTransition] = useTransition();
  const initialTeam = teams.find((team) => team.id === filters.userId);
  const [teamQuery, setTeamQuery] = useState(initialTeam ? teamLabel(initialTeam) : filters.userSearch || "");
  const [from, setFrom] = useState(localTime(filters.from));
  const [to, setTo] = useState(localTime(filters.to));
  const selectedTeam = teams.find((team) => teamLabel(team) === teamQuery);

  return (
    <form
      className="mb-5 rounded-lg border border-blue-100 bg-blue-50/40 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const params = new URLSearchParams({ viewAll: "true" });
        if (selectedTeam) params.set("userId", selectedTeam.id);
        else if (teamQuery.trim()) params.set("userSearch", teamQuery.trim());
        for (const key of ["problem", "language", "verdict", "runId"] as const) {
          const value = String(data.get(key) || "").trim();
          if (value) params.set(key, value);
        }
        if (from) params.set("from", new Date(`${from}+08:00`).toISOString());
        if (to) params.set("to", new Date(`${to}+08:00`).toISOString());
        startTransition(() => router.push(`${pathname}?${params.toString()}`));
      }}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-800">本场提交 · 管理视图</p>
        <p className="text-xs text-gray-500">输入队名快速查找，选择候选队伍可精确定位</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs font-semibold text-gray-600 sm:col-span-2">
          队伍 / 账号 / 学校 / 座位
          <input className={inputClass} list={listId} value={teamQuery} onChange={(event) => setTeamQuery(event.target.value)} placeholder="输入队名，或从候选项选择具体队伍" autoComplete="off" />
          <datalist id={listId}>{teams.map((team) => <option key={team.id} value={teamLabel(team)} />)}</datalist>
          {selectedTeam && <span className="mt-1 block text-blue-700">已精确选择：{selectedTeam.displayName || selectedTeam.username}</span>}
        </label>
        <label className="text-xs font-semibold text-gray-600">
          题目
          <select name="problem" defaultValue={filters.problem || ""} className={inputClass}>
            <option value="">全部题目</option>
            {problems.map((problem) => <option key={problem.displayId} value={problem.displayId}>{problem.displayId} · {problem.title}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-gray-600">
          Run ID
          <input name="runId" type="number" min="1" step="1" defaultValue={filters.runId || ""} placeholder="例如 1234" className={inputClass} />
        </label>
        <label className="text-xs font-semibold text-gray-600">
          判定结果
          <select name="verdict" defaultValue={filters.verdict || ""} className={inputClass}>
            <option value="">全部结果</option>
            {verdicts.map((verdict) => <option key={verdict} value={verdict}>{verdictRecord[verdict] || verdict}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-gray-600">
          语言
          <select name="language" defaultValue={filters.language || ""} className={inputClass}>
            <option value="">全部语言</option>
            {languages.map((language) => <option key={language} value={language}>{languageRecord[language] || language}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-gray-600">
          提交开始时间（北京时间）
          <input type="datetime-local" step="1" value={from} onChange={(event) => setFrom(event.target.value)} className={inputClass} />
        </label>
        <label className="text-xs font-semibold text-gray-600">
          提交结束时间（北京时间）
          <input type="datetime-local" step="1" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} className={inputClass} />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{pending ? "查询中…" : "查询提交"}</button>
        <button type="button" className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50" onClick={() => { setFrom(localTime(new Date(Date.now() - 10 * 60_000).toISOString())); setTo(""); }}>填入最近 10 分钟</button>
        <button type="button" disabled={pending} className="px-2 py-2 text-sm text-gray-600 underline underline-offset-4" onClick={() => startTransition(() => router.push(`${pathname}?viewAll=true`))}>清空筛选</button>
      </div>
    </form>
  );
}
