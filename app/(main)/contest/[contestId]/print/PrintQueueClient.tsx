"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/context/LanguageContext";
import { formatMessage, getLocale } from "@/lib/dictionaries";
import {
  PrintJobStatus,
  type PrintJobStatus as PrintJobStatusType,
} from "@/lib/generated/prisma/enums";
import {
  cancelPrintJob,
  markPrintJobFailed,
  markPrintJobPrinted,
} from "./actions";
import {
  ExclamationTriangleIcon,
  PrinterIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";

type QueueJob = {
  id: number;
  language: string;
  status: PrintJobStatusType;
  errorMessage: string | null;
  sourceFilename: string | null;
  user: {
    username: string;
    displayName: string | null;
    seat: string | null;
  };
};

type RecentJob = {
  id: number;
  language?: string;
  errorMessage?: string | null;
  sourceFilename?: string | null;
  updatedAt?: Date | string;
  printedAt: Date | null;
  user: {
    username: string;
    displayName: string | null;
    seat: string | null;
  };
};

export default function PrintQueueClient({
  contestId,
  jobs,
  rejectedJobs,
  recentPrinted,
}: {
  contestId: number;
  jobs: QueueJob[];
  rejectedJobs: RecentJob[];
  recentPrinted: RecentJob[];
}) {
  const router = useRouter();
  const { dict, lang } = useLanguage();
  const { common, print, printStatus } = dict;
  const formatTime = (date: Date | null) => date
    ? new Date(date).toLocaleString(getLocale(lang), { hour12: false })
    : "-";
  const previewFrameRef = useRef<HTMLIFrameElement>(null);
  const [printingJobId, setPrintingJobId] = useState<number | null>(null);
  const [previewJobId, setPreviewJobId] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const timer = window.setInterval(() => {
      startTransition(() => router.refresh());
    }, 3000);
    return () => window.clearInterval(timer);
  }, [router]);

  const counts = useMemo(
    () => ({
      pending: jobs.filter((job) => job.status === PrintJobStatus.PENDING)
        .length,
      printing: jobs.filter((job) => job.status === PrintJobStatus.PRINTING)
        .length,
      failed: rejectedJobs.length,
    }),
    [jobs, rejectedJobs],
  );

  const selectedJob = jobs.find((job) => job.id === previewJobId) || null;

  const handlePrint = async (jobId: number) => {
    setPrintingJobId(jobId);
    previewFrameRef.current?.contentWindow?.focus();
    previewFrameRef.current?.contentWindow?.print();

    window.setTimeout(async () => {
      await markPrintJobPrinted(contestId, jobId);
      setPreviewJobId(null);
      setPrintingJobId(null);
      startTransition(() => router.refresh());
    }, 1200);
  };

  return (
    <div className="max-w-7xl mx-auto pb-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 font-serif flex items-center gap-2">
            <PrinterIcon className="w-8 h-8 text-slate-700" />
            {dict.nav.printQueue}
          </h1>
          <p className="text-sm text-gray-500 mt-2">
            {print.queueHelp}
          </p>
        </div>
        <div className="grid grid-cols-4 gap-2 text-center">
          <div className="border border-gray-200 bg-white px-4 py-2 rounded-sm">
            <div className="text-xl font-bold text-gray-900">
              {counts.pending}
            </div>
            <div className="text-xs text-gray-500">{printStatus.PENDING}</div>
          </div>
          <div className="border border-gray-200 bg-white px-4 py-2 rounded-sm">
            <div className="text-xl font-bold text-blue-700">
              {counts.printing}
            </div>
            <div className="text-xs text-gray-500">{printStatus.PRINTING}</div>
          </div>
          <div className="border border-gray-200 bg-white px-4 py-2 rounded-sm">
            <div className="text-xl font-bold text-red-700">
              {counts.failed}
            </div>
            <div className="text-xs text-gray-500">{printStatus.FAILED}</div>
          </div>
          <div className="border border-gray-200 bg-white px-4 py-2 rounded-sm">
            <div className="text-xl font-bold text-gray-500">
              {isPending ? "…" : print.on}
            </div>
            <div className="text-xs text-gray-500">{print.autoRefresh}</div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto mb-10">
        <div className="min-w-245">
          <div className="grid grid-cols-[88px_1fr_120px_130px_1fr] gap-4 px-5 py-3 bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-500 uppercase">
            <div>{print.job}</div>
            <div>{common.team}</div>
            <div>{common.seat}</div>
            <div>{dict.contestList.status}</div>
            <div>{common.actions}</div>
          </div>
          {jobs.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">
              {print.noActive}
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="grid grid-cols-[88px_1fr_120px_130px_1fr] gap-4 px-5 py-4 items-center"
                >
                  <div className="font-mono text-gray-700">#{job.id}</div>
                  <div className="min-w-0">
                    <div className="font-bold text-gray-900 truncate">
                      {job.user.displayName || job.user.username}
                    </div>
                    <div className="text-xs text-gray-500 font-mono">
                      {common.id} · {job.user.username} / {job.language}
                    </div>
                    {job.sourceFilename && (
                      <div className="text-xs text-gray-400 truncate">
                        {common.file} · {job.sourceFilename}
                      </div>
                    )}
                    {job.errorMessage && (
                      <div className="mt-1 text-xs text-red-600 flex items-center gap-1">
                        <ExclamationTriangleIcon className="w-4 h-4" />
                        {job.errorMessage}
                      </div>
                    )}
                  </div>
                  <div className="text-2xl font-black text-gray-900">
                    {job.user.seat || "-"}
                  </div>
                  <div>
                    <span className="inline-flex items-center px-2 py-1 rounded-sm text-xs font-bold bg-gray-100 text-gray-700">
                      {printStatus[job.status]}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setPreviewJobId(job.id)}
                      className="inline-flex items-center gap-1 px-4 py-2 text-sm font-bold text-white bg-slate-700 hover:bg-slate-800 rounded-sm"
                    >
                      <PrinterIcon className="w-4 h-4" />
                      {print.preview}
                    </button>
                    <form
                      action={markPrintJobFailed.bind(null, contestId, job.id)}
                      className="flex gap-1"
                    >
                      <input
                        name="reason"
                        placeholder={print.reason}
                        aria-label={print.reason}
                        className="w-24 border border-gray-300 rounded-sm px-2 text-sm"
                      />
                      <button className="px-3 py-2 text-sm font-bold text-red-700 bg-red-50 hover:bg-red-100 rounded-sm">
                        {print.markFailed}
                      </button>
                    </form>
                    <form action={cancelPrintJob.bind(null, contestId, job.id)}>
                      <button className="inline-flex items-center gap-1 px-3 py-2 text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-sm">
                        <XCircleIcon className="w-4 h-4" />
                        {common.cancel}
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedJob && (
        <section className="bg-white border border-gray-200 rounded-sm mb-10 overflow-hidden">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-5 py-4 border-b border-gray-200 bg-gray-50">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                {formatMessage(print.previewTitle, { id: selectedJob.id })}
              </h2>
              <p className="text-sm text-gray-500">
                {selectedJob.user.displayName || selectedJob.user.username} / {common.seat}{" "}
                {selectedJob.user.seat || "-"} /{" "}
                {selectedJob.sourceFilename || selectedJob.language}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handlePrint(selectedJob.id)}
                disabled={printingJobId !== null}
                className="inline-flex items-center gap-1 px-4 py-2 text-sm font-bold text-white bg-green-600 hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed rounded-sm"
              >
                <PrinterIcon className="w-4 h-4" />
                {printingJobId === selectedJob.id ? print.printing : dict.nav.print}
              </button>
              <button
                type="button"
                onClick={() => setPreviewJobId(null)}
                className="px-4 py-2 text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-sm"
              >
                {print.closePreview}
              </button>
            </div>
          </div>
          <iframe
            key={lang}
            ref={previewFrameRef}
            src={`/contest/${contestId}/print/${selectedJob.id}?preview=1`}
            className="w-full h-[760px] bg-white"
            title={formatMessage(print.previewTitle, { id: selectedJob.id })}
          />
        </section>
      )}

      <h2 className="text-xl font-bold text-gray-800 mb-4">{print.rejected}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-10">
        {rejectedJobs.length === 0 ? (
          <div className="col-span-full bg-white border border-gray-200 rounded-sm px-4 py-8 text-center text-sm text-gray-400">
            {print.noRejected}
          </div>
        ) : (
          rejectedJobs.map((job) => (
            <div
              key={job.id}
              className="bg-red-50 border border-red-100 rounded-sm px-4 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold text-gray-800 truncate">
                    #{job.id} / {job.user.displayName || job.user.username}
                  </div>
                  <div className="text-xs text-gray-500">
                    {common.id} · {job.user.username} / {common.seat} {job.user.seat || "-"} /{" "}
                    {job.sourceFilename || job.language || "-"}
                  </div>
                </div>
                <div className="text-xs text-red-700 font-bold bg-red-100 px-2 py-1 rounded-sm">
                  {printStatus.FAILED}
                </div>
              </div>
              <div className="mt-2 text-sm text-red-700 flex gap-1">
                <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{job.errorMessage === "Print failed." ? print.defaultFailure : job.errorMessage || print.rejectedWithoutReason}</span>
              </div>
              <div className="text-xs text-gray-400 mt-2">
                {job.updatedAt ? formatTime(new Date(job.updatedAt)) : "-"}
              </div>
            </div>
          ))
        )}
      </div>

      <h2 className="text-xl font-bold text-gray-800 mb-4">{print.recentlyPrinted}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {recentPrinted.map((job) => (
          <div
            key={job.id}
            className="bg-gray-50 border border-gray-200 rounded-sm px-4 py-3 flex items-center justify-between"
          >
            <div>
              <div className="font-bold text-gray-700">
                #{job.id} / {job.user.displayName || job.user.username}
              </div>
              <div className="text-xs text-gray-500">
                {common.id} · {job.user.username} / {common.seat} {job.user.seat || "-"}
              </div>
            </div>
            <div className="text-xs text-gray-400">
              {formatTime(job.printedAt)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
