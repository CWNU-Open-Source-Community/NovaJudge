"use client";

import { useEffect, useState } from "react";
import { ServerIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import { useAdminLocale } from "@/components/admin/useAdminLocale";
import { getVerdictLabel } from "@/lib/dictionaries";

export interface JudgeWorkerInfo {
  id: string;
  pid: number;
  hostname: string;
  platform: string;
  concurrency: number;
  startedAt: number;
  lastHeartbeat: number;
  processed: number;
  activeJobs: { jobId: string; submissionId: string }[];
  judgeApi: string;
}

interface JudgeWorkersData {
  workers: JudgeWorkerInfo[];
  queue: Record<string, number> | null;
}

function formatDuration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

const QUEUE_ITEMS = [
  { key: "waiting", en: "Waiting", zh: "排队", classes: "bg-yellow-50 text-yellow-700 border-yellow-100" },
  { key: "active", en: "Active", zh: "评测中", classes: "bg-blue-50 text-blue-700 border-blue-100" },
  { key: "completed", en: "Done", zh: "完成", classes: "bg-green-50 text-green-700 border-green-100" },
  { key: "failed", en: "Failed", zh: "失败", classes: "bg-red-50 text-red-700 border-red-100" },
];

export default function JudgeWorkers({ initial }: { initial: JudgeWorkersData }) {
  const { t, locale } = useAdminLocale();
  const [data, setData] = useState<JudgeWorkersData>(initial);
  // 挂载后每秒刷新一次当前时间，让「X 秒前」显示保持新鲜；
  // 服务端渲染时为 null，渲染占位符，避免 hydration 不一致。
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    let stopped = false;

    async function poll() {
      try {
        const res = await fetch("/api/admin/judge-workers", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as JudgeWorkersData;
        if (!stopped) setData(json);
      } catch {
        // 网络抖动时保留上一次的数据
      }
    }

    poll();
    const pollTimer = setInterval(poll, 5000);
    return () => {
      stopped = true;
      clearInterval(pollTimer);
    };
  }, []);

  useEffect(() => {
    const clockTimer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clockTimer);
  }, []);

  const { workers, queue } = data;

  return (
    <section className="admin-card p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
          <ServerIcon className="size-5 text-gray-500" aria-hidden="true" />
          {t("Judge workers", "判题进程")}
        </h2>
        <span
          className={`text-xs font-bold px-2 py-1 rounded ${workers.length > 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}
        >
          {workers.length > 0 ? t(`${workers.length} online`, `${workers.length} 个在线`) : t("Offline", "离线")}
        </span>
      </div>

      {/* 队列统计 */}
      {queue ? (
        <dl className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {QUEUE_ITEMS.map((item) => (
            <div
              key={item.key}
              className={`flex flex-col-reverse gap-1 rounded-lg border p-2.5 text-center ${item.classes}`}
            >
              <dt className="text-xs font-medium">{t(item.en, item.zh)}</dt>
              <dd className="text-base font-semibold tabular-nums">{(queue[item.key] ?? 0).toLocaleString(locale)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mb-4 rounded-md bg-yellow-50 px-3 py-2 text-xs text-yellow-800">{t("Queue statistics are unavailable.", "暂时无法读取队列统计。")}</p>
      )}

      {/* 判题机列表 */}
      {workers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-5 text-center text-sm text-gray-600">
          <div className="mb-2">{t("No judge workers are online.", "当前没有在线判题进程。")}</div>
          <code className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700">
            npm run worker
          </code>
        </div>
      ) : (
        <div className="space-y-3">
          {workers.map((w) => (
            <div
              key={w.id}
              className="bg-gray-50 rounded-lg p-3.5 border border-gray-100"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full bg-green-500" aria-hidden="true" />
                  <span className="max-w-full wrap-break-word rounded-md bg-blue-50 px-2 py-0.5 font-mono text-xs font-semibold text-blue-700">
                    #{w.id}
                  </span>
                  <span className="min-w-0 wrap-break-word text-xs text-gray-600">
                    {w.hostname} · PID {w.pid}
                  </span>
                </div>
                <span className="whitespace-nowrap text-xs text-gray-600">
                  {now === null ? "—" : t(`${formatDuration(now - w.lastHeartbeat)} ago`, `${formatDuration(now - w.lastHeartbeat)} 前`)}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5 text-xs font-medium">
                <span className="px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-600">
                  {t(`${w.concurrency} concurrent`, `并发 ${w.concurrency}`)}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-600">
                  {t(`${w.processed} judged`, `已评 ${w.processed}`)}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-600">
                  {t("Uptime", "运行")} {now === null ? "—" : formatDuration(now - w.startedAt)}
                </span>
                {w.activeJobs.map((job) => (
                  <span
                    key={job.jobId}
                    className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 border border-blue-200 font-mono"
                  >
                    {getVerdictLabel("JUDGING")} {job.submissionId.slice(0, 8)}…
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-1.5 text-xs text-gray-600">
        <ArrowPathIcon className="size-3.5 shrink-0" aria-hidden="true" />
        {t("Updates every 5 seconds", "每 5 秒刷新")}
      </div>
    </section>
  );
}
