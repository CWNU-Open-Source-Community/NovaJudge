"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogPanel, DialogTitle, Description } from "@headlessui/react";
import { toast } from "sonner";
import type { ContestSubmissionFilters } from "@/lib/contest-rejudge-types";
import { executeContestRejudge, getContestRejudgeProgress, previewContestRejudge } from "./rejudge-actions";

type Preview = { token: string; count: number; sample: { id: string; displayId: number; teamName: string; problemLabel: string; verdict: string }[]; scope: string; scopeKey: string };
type Progress = { pending: number; judging: number; completed: number; failed: number };
type Batch = { ids: string[]; skipped: number; failed: number };

export const rejudgeButtonClass = "rounded-md border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40";

export function useContestRejudge(contestId: number, scopeKey = String(contestId)) {
  const router = useRouter();
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
  const [progressError, setProgressError] = useState("");

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
          setProgressError("");
          if (next.pending === 0 && next.judging === 0) {
            router.refresh();
            return;
          }
        }
      } catch {
        if (stopped) return;
        setProgressError("暂时无法获取评测进度，正在重试。");
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

  const prepare = async (input: { filters: ContestSubmissionFilters; submissionIds?: string[]; includeAccepted?: boolean }, scope: string) => {
    const version = ++requestVersion.current;
    setPreview(null);
    setPreparingScope(scopeKey);
    try {
      const result = await previewContestRejudge(contestId, input);
      if (version !== requestVersion.current) return;
      if (result.error) toast.error(result.error);
      else if (!result.token || !result.count) toast.info("没有可以重判的提交：已跳过 AC（除非勾选）、排队中和评测中的记录。");
      else setPreview({ token: result.token, count: result.count, sample: result.sample || [], scope, scopeKey });
    } catch {
      if (version === requestVersion.current) toast.error("无法预览重判范围，请重试。");
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
        setProgressError("");
      }
      if (result.queued) toast.success(`已入队 ${result.queued} 条提交，正在等待评测。`);
      router.refresh();
    } catch {
      toast.error("重判请求未能确认，请刷新提交状态后再操作。");
    } finally {
      setExecuting(false);
    }
  };

  return { preview, busy, batch, progress, progressError, prepare, execute, cancel };
}

export function RejudgeFeedback({ control }: { control: ReturnType<typeof useContestRejudge> }) {
  const { preview, busy, batch, progress, progressError } = control;
  const finished = progress && progress.pending === 0 && progress.judging === 0;
  return <>
    {batch && <div role="status" className="my-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
      <p className="font-semibold">{batch.ids.length === 0 ? "本次未入队" : finished ? "本次重判已结束" : "本次重判进度"}</p>
      <p className="mt-1">已入队 {batch.ids.length} 条 · 跳过 {batch.skipped} 条 · 入队失败 {batch.failed} 条</p>
      {progress && <p className="mt-1">排队 {progress.pending} · 评测中 {progress.judging} · 已完成 {progress.completed} · 评测失败 {progress.failed}</p>}
      {batch.ids.length > 0 && !progress && !progressError && <p className="mt-1">正在获取评测进度…</p>}
      {progressError && <p className="mt-1 text-amber-800">{progressError}</p>}
      {progress && <progress aria-label="重判评测进度" max={batch.ids.length || 1} value={progress.completed + progress.failed} className="mt-2 h-2 w-full accent-blue-600" />}
    </div>}
    <Dialog open={preview !== null} onClose={control.cancel} className="relative z-50">
      <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
      <div className="fixed inset-0 overflow-y-auto p-4"><div className="flex min-h-full items-center justify-center">
        <DialogPanel className="w-full max-w-xl rounded-xl bg-white p-5 shadow-xl">
          <DialogTitle className="text-lg font-semibold text-gray-900">确认重判 {preview?.count} 条提交</DialogTitle>
          <Description className="mt-2 text-sm text-gray-600">{preview?.scope}。本次清单已固定，之后新增的提交不会加入；执行时会跳过已进入评测的记录。</Description>
          {preview && preview.sample.length > 0 && <div className="mt-4 overflow-x-auto rounded-md border border-gray-200"><table className="w-full text-left text-sm">
            <caption className="px-3 py-2 text-left text-xs text-gray-500">清单预览（前 {preview.sample.length} 条 / 共 {preview.count} 条）</caption>
            <thead className="bg-gray-50 text-gray-700"><tr><th className="p-2">Run ID</th><th className="p-2">队伍</th><th className="p-2">题目</th><th className="p-2">当前结果</th></tr></thead>
            <tbody>{preview.sample.map((row) => <tr key={row.id} className="border-t border-gray-100"><td className="p-2">{row.displayId}</td><td className="p-2">{row.teamName}</td><td className="p-2">{row.problemLabel}</td><td className="p-2 text-xs">{row.verdict}</td></tr>)}</tbody>
          </table></div>}
          <div className="mt-5 flex justify-end gap-3">
            <button type="button" data-autofocus onClick={control.cancel} className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700">取消</button>
            <button type="button" disabled={busy} onClick={() => void control.execute()} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">确认重判 {preview?.count} 条</button>
          </div>
        </DialogPanel>
      </div></div>
    </Dialog>
  </>;
}

export function ContestRejudgeButton({ contestId, submissionId, verdict }: { contestId: number; submissionId: string; verdict: string }) {
  const control = useContestRejudge(contestId, submissionId);
  const [includeAccepted, setIncludeAccepted] = useState(false);
  const inProgress = verdict === "PENDING" || verdict === "JUDGING";
  return <div>
    <div className="flex flex-wrap items-center gap-3">
      {verdict === "ACCEPTED" && <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={includeAccepted} disabled={control.busy} onChange={(event) => { control.cancel(); setIncludeAccepted(event.target.checked); }} />允许重判该 AC 提交</label>}
      <button type="button" className={rejudgeButtonClass} disabled={control.busy || inProgress || (verdict === "ACCEPTED" && !includeAccepted)} onClick={() => void control.prepare({ filters: {}, submissionIds: [submissionId], includeAccepted }, "当前提交")}>{control.busy ? "正在处理…" : inProgress ? "正在评测，暂不可重判" : "重判此提交"}</button>
    </div>
    <RejudgeFeedback control={control} />
  </div>;
}
