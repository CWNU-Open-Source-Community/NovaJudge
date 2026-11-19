"use client";

import { useState } from "react";
import Link from "next/link";
import VerdictCell from "@/components/VerdictCell";
import { useLanguage } from "@/context/LanguageContext";
import { formatMessage, getLocale } from "@/lib/dictionaries";
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
  const { dict, lang } = useLanguage();
  const { common, rejudge, submission: submissionCopy } = dict;
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
    ids ? { count: ids.length } : "matching",
  );

  return <section aria-label={rejudge.title}>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-lg border border-gray-200 bg-gray-50 p-3">
      <div>
        <p className="text-sm font-semibold text-gray-800">{formatMessage(rejudge.summary, { total: totalCount, shown: submissions.length, selected: selected.length })}</p>
        <p className="mt-1 text-xs text-gray-500">{rejudge.help}</p>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={includeAccepted} disabled={control.busy || disabled} onChange={(event) => { control.cancel(); setSelectedIds([]); setIncludeAccepted(event.target.checked); }} />{rejudge.includeAccepted}</label>
      <div className="flex w-full flex-wrap gap-2">
        <button type="button" className={rejudgeButtonClass} disabled={disabled || control.busy || selected.length === 0} onClick={() => void prepare(selected)}>{formatMessage(rejudge.rejudgeSelected, { count: selected.length })}</button>
        <button type="button" className={rejudgeButtonClass} disabled={disabled || control.busy || totalCount === 0} onClick={() => void prepare()}>{rejudge.rejudgeMatching}</button>
        {control.busy && <span role="status" className="self-center text-sm text-gray-500">{rejudge.processing}</span>}
      </div>
    </div>
    <RejudgeFeedback control={{ ...control, execute: async () => { await control.execute(); setSelectedIds([]); } }} />
    {submissions.length === 0 ? <p className="border border-t-0 border-gray-200 py-10 text-center text-sm text-gray-500">{rejudge.noMatches}</p> : <div className="overflow-x-auto rounded-b-lg border border-t-0 border-gray-200">
      <table className="min-w-[960px] w-full text-left text-sm">
        <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold text-gray-700"><tr>
          <th className="p-3"><input type="checkbox" aria-label={rejudge.selectAll} checked={allPageSelected} disabled={disabled || control.busy || eligibleIds.length === 0} onChange={(event) => { control.cancel(); setSelectedIds(event.target.checked ? eligibleIds : []); }} /></th>
          <th className="p-3">{submissionCopy.runId}</th><th className="p-3">{rejudge.teamAccount}</th><th className="p-3">{submissionCopy.problem}</th><th className="p-3">{submissionCopy.submitTime}</th><th className="p-3">{common.language}</th><th className="p-3">{rejudge.currentVerdict}</th><th className="p-3">{rejudge.timeAndMemory}</th><th className="p-3">{common.actions}</th>
        </tr></thead>
        <tbody>{submissions.map((submission) => <tr key={submission.id} className="border-b border-gray-100 last:border-b-0 odd:bg-white even:bg-blue-50/30 hover:bg-blue-50">
          <td className="p-3"><input type="checkbox" aria-label={formatMessage(rejudge.selectRun, { id: submission.displayId })} checked={selected.includes(submission.id)} disabled={disabled || control.busy || !eligible(submission)} onChange={(event) => { control.cancel(); setSelectedIds(event.target.checked ? [...selectedIds, submission.id] : selectedIds.filter((id) => id !== submission.id)); }} /></td>
          <td className="p-3 font-mono"><Link href={`/contest/${contestId}/status/${submission.displayId}`} className="font-semibold text-blue-600 hover:underline">{submission.displayId}</Link></td>
          <td className="max-w-64 p-3"><p className="break-words font-semibold text-gray-900">{submission.teamName}</p><p className="mt-1 text-xs text-gray-500">{submission.username}{submission.seat && ` · ${formatMessage(common.seatNumber, { seat: submission.seat })}`}</p>{submission.school && <p className="mt-1 text-xs text-gray-500">{submission.school}</p>}{submission.virtualAttempt !== null && <span className="text-xs text-blue-600">VP #{submission.virtualAttempt}</span>}</td>
          <td className="max-w-52 p-3"><Link href={`/contest/${contestId}/problems/${submission.problemLabel}`} className="font-semibold text-blue-600 hover:underline">{submission.problemLabel}</Link><p className="mt-1 line-clamp-2 text-xs text-gray-500">{submission.problemTitle}</p></td>
          <td className="whitespace-nowrap p-3 text-xs text-gray-600">{new Date(submission.submittedAt).toLocaleString(getLocale(lang), { timeZone: "Asia/Shanghai", hour12: false })}</td>
          <td className="p-3"><Link href={`/contest/${contestId}/status/${submission.displayId}`} className="text-blue-600 hover:underline">{submission.language}</Link></td>
          <td className="p-3"><VerdictCell key={`${submission.id}-${submission.verdict}`} submission={submission} showTestDetails /></td>
          <td className="whitespace-nowrap p-3 text-xs text-gray-500">{submission.timeUsed === null ? "-" : `${submission.timeUsed} ms`} / {submission.memoryUsed === null ? "-" : `${submission.memoryUsed} KB`}</td>
          <td className="p-3"><button type="button" disabled={disabled || control.busy || !eligible(submission)} title={submission.verdict === "ACCEPTED" && !includeAccepted ? rejudge.enableAccepted : !eligible(submission) ? rejudge.inProgress : rejudge.previewSingle} className={rejudgeButtonClass + " whitespace-nowrap"} onClick={() => void prepare([submission.id])}>{rejudge.rejudge}</button></td>
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}
