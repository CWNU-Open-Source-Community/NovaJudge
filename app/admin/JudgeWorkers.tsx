"use client";

import { useEffect, useState } from "react";
import { ServerIcon, ArrowPathIcon } from "@heroicons/react/24/outline";

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

const QUEUE_ITEMS: { key: string; label: string; classes: string }[] = [
  { key: "waiting", label: "Waiting", classes: "bg-yellow-50 text-yellow-700 border-yellow-100" },
  { key: "active", label: "Active", classes: "bg-blue-50 text-blue-700 border-blue-100" },
  { key: "completed", label: "Done", classes: "bg-green-50 text-green-700 border-green-100" },
  { key: "failed", label: "Failed", classes: "bg-red-50 text-red-700 border-red-100" },
];

export default function JudgeWorkers({ initial }: { initial: JudgeWorkersData }) {
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
    <div className="bg-white shadow-sm rounded-xl border border-gray-200 p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-bold text-gray-800 flex items-center gap-2">
          <ServerIcon className="w-5 h-5 text-gray-500" />
          Judge Workers
        </h3>
        <span
          className={`text-xs font-bold px-2 py-1 rounded ${workers.length > 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}
        >
          {workers.length > 0 ? `${workers.length} ONLINE` : "OFFLINE"}
        </span>
      </div>

      {/* 队列统计 */}
      {queue && (
        <div className="grid grid-cols-4 gap-2 mb-4">
          {QUEUE_ITEMS.map((item) => (
            <div
              key={item.key}
              className={`rounded-lg border px-2 py-2 text-center ${item.classes}`}
            >
              <div className="text-sm font-bold leading-none">
                {queue[item.key] ?? 0}
              </div>
              <div className="text-[10px] font-medium mt-1">{item.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* 判题机列表 */}
      {workers.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-400 border border-dashed border-gray-200 rounded-lg">
          <div className="mb-1">No judge worker online.</div>
          <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">
            npm run worker:multi -- 4
          </code>
        </div>
      ) : (
        <div className="space-y-3">
          {workers.map((w) => (
            <div
              key={w.id}
              className="bg-gray-50 rounded-lg p-3.5 border border-gray-100"
            >
              <div className="flex justify-between items-start gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                  </span>
                  <span className="font-mono text-xs font-bold bg-blue-600 text-white px-2 py-0.5 rounded">
                    #{w.id}
                  </span>
                  <span className="text-xs text-gray-600">
                    {w.hostname} · PID {w.pid}
                  </span>
                </div>
                <span className="text-[10px] text-gray-400 whitespace-nowrap">
                  {now === null ? "—" : `${formatDuration(now - w.lastHeartbeat)} ago`}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-medium">
                <span className="px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-600">
                  ⚙️ {w.concurrency} concurrent
                </span>
                <span className="px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-600">
                  ✅ {w.processed} judged
                </span>
                <span className="px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-600">
                  ⏱ up {now === null ? "—" : formatDuration(now - w.startedAt)}
                </span>
                {w.activeJobs.map((job) => (
                  <span
                    key={job.jobId}
                    className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 border border-blue-200 font-mono"
                  >
                    judging {job.submissionId.slice(0, 8)}…
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-gray-400">
        <ArrowPathIcon className="w-3 h-3 shrink-0" />
        Auto-refresh every 5s · jobs are claimed atomically from Redis, so two workers never judge the same submission
      </div>
    </div>
  );
}
