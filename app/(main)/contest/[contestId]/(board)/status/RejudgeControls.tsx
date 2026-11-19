"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogPanel, DialogTitle, Description } from "@headlessui/react";
import { toast } from "sonner";
import { useLanguage } from "@/context/LanguageContext";
import { formatMessage, getVerdictLabel } from "@/lib/dictionaries";
import type { ContestSubmissionFilters } from "@/lib/contest-rejudge-types";
import { executeContestRejudge, getContestRejudgeProgress, previewContestRejudge } from "./rejudge-actions";

type RejudgeScope = "single" | "matching" | { count: number };

type Preview = { token: string; count: number; sample: { id: string; displayId: number; teamName: string; problemLabel: string; verdict: string }[]; scope: RejudgeScope; includeAccepted: boolean; scopeKey: string };
type Progress = { pending: number; judging: number; completed: number; failed: number };
type Batch = { ids: string[]; skipped: number; failed: number };

export const rejudgeButtonClass = "rounded-md border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40";

export function useContestRejudge(contestId: number, scopeKey = String(contestId)) {
  const router = useRouter();
  const { dict: { rejudge } } = useLanguage();
  const requestVersion = useRef(0);
  const [storedPreview, setPreview] = useState<Preview | null>(null);
  const preview = storedPreview?.scopeKey === scopeKey ? storedPreview : null;
  const [preparingScope, setPreparingScope] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [previousScope, setPreviousScope] = useState(scopeKey);
  if (previousScope !== scopeKey) {
    setPreviousScope(scopeKey);
    setPreview(null);
    setPreparingScope(null);
  }
  const busy = preparingScope === scopeKey || executing;
  const [batch, setBatch] = useState<Batch | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [progressError, setProgressError] = useState<string | true | null>(null);

  // A changed query invalidates any outstanding preview, but preserves batch progress.
  useEffect(() => () => { requestVersion.current++; }, [scopeKey]);

  useEffect(() => {
    if (!batch?.ids.length) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await getContestRejudgeProgress(contestId, batch.ids);
        if (stopped) return;
        if (result.error) {
          setProgressError(result.error);
        } else {
          const next = { pending: result.pending || 0, judging: result.judging || 0, completed: result.completed || 0, failed: result.failed || 0 };
          setProgress(next);
          setProgressError(null);
          if (next.pending === 0 && next.judging === 0) {
            router.refresh();
            return;
          }
        }
      } catch {
        if (stopped) return;
        setProgressError(true);
      }
      timer = setTimeout(poll, 2500);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [batch, contestId, router]);

  const cancel = () => {
    requestVersion.current++;
    setPreview(null);
    setPreparingScope(null);
  };

  const prepare = async (input: { filters: ContestSubmissionFilters; submissionIds?: string[]; includeAccepted?: boolean }, scope: RejudgeScope) => {
    const version = ++requestVersion.current;
    setPreview(null);
    setPreparingScope(scopeKey);
    try {
      const result = await previewContestRejudge(contestId, input);
      if (version !== requestVersion.current) return;
      if (result.error) toast.error(result.error);
      else if (!result.token || !result.count) toast.info(rejudge.emptyPreview);
      else setPreview({ token: result.token, count: result.count, sample: result.sample || [], scope, includeAccepted: input.includeAccepted === true, scopeKey });
    } catch {
      if (version === requestVersion.current) toast.error(rejudge.previewFailed);
    } finally {
      if (version === requestVersion.current) setPreparingScope(null);
    }
  };

  const execute = async () => {
    if (!preview || busy) return;
    const token = preview.token;
    setExecuting(true);
    setPreview(null);
    try {
      const result = await executeContestRejudge(contestId, token);
      if (result.error) toast.error(result.error);
      if (result.submissionIds?.length || result.failed || result.skipped) {
        setBatch({ ids: result.submissionIds || [], failed: result.failed || 0, skipped: result.skipped || 0 });
        setProgress(null);
        setProgressError(null);
      }
      if (result.queued) toast.success(formatMessage(rejudge.queued, { count: result.queued }));
      router.refresh();
    } catch {
      toast.error(rejudge.executeFailed);
    } finally {
      setExecuting(false);
    }
  };

  return { preview, busy, batch, progress, progressError, prepare, execute, cancel };
}

export function RejudgeFeedback({ control }: { control: ReturnType<typeof useContestRejudge> }) {
  const { dict } = useLanguage();
  const { common, rejudge, submission } = dict;
  const { preview, busy, batch, progress, progressError } = control;
  const scope = preview?.scope === "single" ? rejudge.scopeSingle
    : preview?.scope === "matching" ? rejudge.scopeMatches
    : preview ? formatMessage(rejudge.scopeSelected, { count: preview.scope.count }) : "";
  const finished = progress && progress.pending === 0 && progress.judging === 0;
  return <>
    {batch && <div role="status" className="my-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
      <p className="font-semibold">{batch.ids.length === 0 ? rejudge.batchEmpty : finished ? rejudge.batchFinished : rejudge.batchProgress}</p>
      <p className="mt-1">{formatMessage(rejudge.batchSummary, { queued: batch.ids.length, skipped: batch.skipped, failed: batch.failed })}</p>
      {progress && <p className="mt-1">{formatMessage(rejudge.progressSummary, progress)}</p>}
      {batch.ids.length > 0 && !progress && !progressError && <p className="mt-1">{rejudge.loadingProgress}</p>}
      {progressError && <p className="mt-1 text-amber-800">{progressError === true ? rejudge.progressUnavailable : progressError}</p>}
      {progress && <progress aria-label={rejudge.batchProgress} max={batch.ids.length || 1} value={progress.completed + progress.failed} className="mt-2 h-2 w-full accent-blue-600" />}
    </div>}
    <Dialog open={preview !== null} onClose={control.cancel} className="relative z-50">
      <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
      <div className="fixed inset-0 overflow-y-auto p-4"><div className="flex min-h-full items-center justify-center">
        <DialogPanel className="w-full max-w-xl rounded-xl bg-white p-5 shadow-xl">
          <DialogTitle className="text-lg font-semibold text-gray-900">{formatMessage(rejudge.confirm, { count: preview?.count ?? 0 })}</DialogTitle>
          <Description className="mt-2 text-sm text-gray-600">{formatMessage(rejudge.scopeDescription, { scope, accepted: preview?.includeAccepted ? rejudge.scopeIncludingAccepted : rejudge.scopeExcludingAccepted })}</Description>
          {preview && preview.sample.length > 0 && <div className="mt-4 overflow-x-auto rounded-md border border-gray-200"><table className="w-full text-left text-sm">
            <caption className="px-3 py-2 text-left text-xs text-gray-500">{formatMessage(rejudge.previewCaption, { shown: preview.sample.length, total: preview.count })}</caption>
            <thead className="bg-gray-50 text-gray-700"><tr><th className="p-2">{submission.runId}</th><th className="p-2">{common.team}</th><th className="p-2">{submission.problem}</th><th className="p-2">{rejudge.currentVerdict}</th></tr></thead>
            <tbody>{preview.sample.map((row) => <tr key={row.id} className="border-t border-gray-100"><td className="p-2">{row.displayId}</td><td className="p-2">{row.teamName}</td><td className="p-2">{row.problemLabel}</td><td className="p-2 text-xs">{getVerdictLabel(row.verdict)}</td></tr>)}</tbody>
          </table></div>}
          <div className="mt-5 flex justify-end gap-3">
            <button type="button" data-autofocus onClick={control.cancel} className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700">{common.cancel}</button>
            <button type="button" disabled={busy} onClick={() => void control.execute()} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{formatMessage(rejudge.confirmButton, { count: preview?.count ?? 0 })}</button>
          </div>
        </DialogPanel>
      </div></div>
    </Dialog>
  </>;
}

export function ContestRejudgeButton({ contestId, submissionId, verdict }: { contestId: number; submissionId: string; verdict: string }) {
  const { dict: { rejudge } } = useLanguage();
  const control = useContestRejudge(contestId, submissionId);
  const [includeAccepted, setIncludeAccepted] = useState(false);
  const inProgress = verdict === "PENDING" || verdict === "JUDGING";
  return <div>
    <div className="flex flex-wrap items-center gap-3">
      {verdict === "ACCEPTED" && <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={includeAccepted} disabled={control.busy} onChange={(event) => { control.cancel(); setIncludeAccepted(event.target.checked); }} />{rejudge.acceptSingle}</label>}
      <button type="button" className={rejudgeButtonClass} disabled={control.busy || inProgress || (verdict === "ACCEPTED" && !includeAccepted)} onClick={() => void control.prepare({ filters: {}, submissionIds: [submissionId], includeAccepted }, "single")}>{control.busy ? rejudge.processing : inProgress ? rejudge.inProgress : rejudge.rejudgeSingle}</button>
    </div>
    <RejudgeFeedback control={control} />
  </div>;
}
