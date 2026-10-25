"use client";

import { useState } from "react";
import Link from "next/link";
import VerdictCell from "@/components/VerdictCell";
import type { ContestSubmissionFilters } from "@/lib/contest-rejudge-types";
import { RejudgeFeedback, rejudgeButtonClass, useContestRejudge } from "./RejudgeControls";

export type ManagedSubmission = {
  id: string;
  displayId: number;
  teamName: string;
  username: string;
  school: string | null;
  seat: string | null;
  problemLabel: string;
  problemTitle: string;
  submittedAt: string;
  language: string;
  verdict: string;
  timeUsed: number | null;
  memoryUsed: number | null;
  passedTests: number;
  totalTests: number;
  errorMessage: string | null;
  virtualAttempt: number | null;
};

export default function ContestRejudgePanel({ contestId, scopeKey, filters, submissions, totalCount, disabled = false }: {
  contestId: number;
  scopeKey: string;
  filters: ContestSubmissionFilters;
  submissions: ManagedSubmission[];
  totalCount: number;
  disabled?: boolean;
}) {
  const [selection, setSelection] = useState<{ scopeKey: string; ids: string[] }>({ scopeKey, ids: [] });
  if (selection.scopeKey !== scopeKey) setSelection({ scopeKey, ids: [] });
  const selectedIds = selection.scopeKey === scopeKey ? selection.ids : [];
  const setSelectedIds = (ids: string[]) => setSelection({ scopeKey, ids });
  const [includeAccepted, setIncludeAccepted] = useState(false);
  const control = useContestRejudge(contestId, scopeKey);
  const eligible = (submission: ManagedSubmission) => submission.verdict !== "PENDING" && submission.verdict !== "JUDGING" && (includeAccepted || submission.verdict !== "ACCEPTED");
  const eligibleIds = submissions.filter(eligible).map((submission) => submission.id);
  const selected = selectedIds.filter((id) => eligibleIds.includes(id));
  const allPageSelected = eligibleIds.length > 0 && eligibleIds.every((id) => selected.includes(id));
  const prepare = (ids?: string[]) => control.prepare(
    { filters, submissionIds: ids, includeAccepted },
    ids ? `已选择 ${ids.length} 条提交${includeAccepted ? "（包含 AC）" : "（不含 AC）"}` : `当前筛选的全部匹配结果，包含其他分页${includeAccepted ? "（包含 AC）" : "（不含 AC）"}`,
  );

  return <section aria-label="本场重判操作">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-lg border border-gray-200 bg-gray-50 p-3">
      <div>
        <p className="text-sm font-semibold text-gray-800">当前筛选共 {totalCount} 条 · 本页 {submissions.length} 条 · 已勾选 {selected.length} 条</p>
        <p className="mt-1 text-xs text-gray-500">排队中和评测中的提交自动跳过。修改上方条件后，先点击“查询提交”。</p>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={includeAccepted} disabled={control.busy || disabled} onChange={(event) => { control.cancel(); setSelectedIds([]); setIncludeAccepted(event.target.checked); }} />包含已 AC 的提交</label>
      <div className="flex w-full flex-wrap gap-2">
        <button type="button" className={rejudgeButtonClass} disabled={disabled || control.busy || selected.length === 0} onClick={() => void prepare(selected)}>重判勾选的 {selected.length} 条</button>
        <button type="button" className={rejudgeButtonClass} disabled={disabled || control.busy || totalCount === 0} onClick={() => void prepare()}>重判全部匹配结果（跨分页）</button>
        {control.busy && <span role="status" className="self-center text-sm text-gray-500">正在处理，请稍候…</span>}
      </div>
    </div>
    <RejudgeFeedback control={{ ...control, execute: async () => { await control.execute(); setSelectedIds([]); } }} />
    {submissions.length === 0 ? <p className="border border-t-0 border-gray-200 py-10 text-center text-sm text-gray-500">没有符合当前筛选条件的提交。</p> : <div className="overflow-x-auto rounded-b-lg border border-t-0 border-gray-200">
      <table className="min-w-[960px] w-full text-left text-sm">
        <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold text-gray-700"><tr>
          <th className="p-3"><input type="checkbox" aria-label="勾选本页所有可重判提交" checked={allPageSelected} disabled={disabled || control.busy || eligibleIds.length === 0} onChange={(event) => { control.cancel(); setSelectedIds(event.target.checked ? eligibleIds : []); }} /></th>
          <th className="p-3">Run ID</th><th className="p-3">队伍 / 账号</th><th className="p-3">题目</th><th className="p-3">提交时间</th><th className="p-3">语言</th><th className="p-3">当前结果</th><th className="p-3">用时 / 内存</th><th className="p-3">操作</th>
        </tr></thead>
        <tbody>{submissions.map((submission) => <tr key={submission.id} className="border-b border-gray-100 last:border-b-0 odd:bg-white even:bg-blue-50/30 hover:bg-blue-50">
          <td className="p-3"><input type="checkbox" aria-label={`选择 Run ${submission.displayId}`} checked={selected.includes(submission.id)} disabled={disabled || control.busy || !eligible(submission)} onChange={(event) => { control.cancel(); setSelectedIds(event.target.checked ? [...selectedIds, submission.id] : selectedIds.filter((id) => id !== submission.id)); }} /></td>
          <td className="p-3 font-mono"><Link href={`/contest/${contestId}/status/${submission.displayId}`} className="font-semibold text-blue-600 hover:underline">{submission.displayId}</Link></td>
          <td className="max-w-64 p-3"><p className="break-words font-semibold text-gray-900">{submission.teamName}</p><p className="mt-1 text-xs text-gray-500">{submission.username}{submission.seat && ` · 座位 ${submission.seat}`}</p>{submission.school && <p className="mt-1 text-xs text-gray-500">{submission.school}</p>}{submission.virtualAttempt !== null && <span className="text-xs text-blue-600">VP #{submission.virtualAttempt}</span>}</td>
          <td className="max-w-52 p-3"><Link href={`/contest/${contestId}/problems/${submission.problemLabel}`} className="font-semibold text-blue-600 hover:underline">{submission.problemLabel}</Link><p className="mt-1 line-clamp-2 text-xs text-gray-500">{submission.problemTitle}</p></td>
          <td className="whitespace-nowrap p-3 text-xs text-gray-600">{new Date(submission.submittedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</td>
          <td className="p-3"><Link href={`/contest/${contestId}/status/${submission.displayId}`} className="text-blue-600 hover:underline">{submission.language}</Link></td>
          <td className="p-3"><VerdictCell key={`${submission.id}-${submission.verdict}`} submission={submission} showTestDetails /></td>
          <td className="whitespace-nowrap p-3 text-xs text-gray-500">{submission.timeUsed === null ? "-" : `${submission.timeUsed} ms`} / {submission.memoryUsed === null ? "-" : `${submission.memoryUsed} KB`}</td>
          <td className="p-3"><button type="button" disabled={disabled || control.busy || !eligible(submission)} title={submission.verdict === "ACCEPTED" && !includeAccepted ? "勾选“包含已 AC 的提交”后可重判" : !eligible(submission) ? "排队或评测中的提交不可重判" : "预览并重判此提交"} className={rejudgeButtonClass + " whitespace-nowrap"} onClick={() => void prepare([submission.id])}>重判</button></td>
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}
