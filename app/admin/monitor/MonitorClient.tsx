"use client";

import { useEffect, useState } from "react";
import {
  ArrowPathIcon,
  ClockIcon,
  QueueListIcon,
  ServerIcon,
  TrophyIcon,
  UsersIcon,
  ChartBarIcon,
} from "@heroicons/react/24/outline";
import type {
  MonitorStats,
  MonitorMinuteBucket,
} from "@/lib/monitor";

// 判定结果的展示配色（与 VerdictBadge 风格一致）
const VERDICT_COLORS: Record<string, string> = {
  ACCEPTED: "bg-green-100 text-green-700",
  WRONG_ANSWER: "bg-red-100 text-red-700",
  TIME_LIMIT_EXCEEDED: "bg-amber-100 text-amber-700",
  MEMORY_LIMIT_EXCEEDED: "bg-purple-100 text-purple-700",
  RUNTIME_ERROR: "bg-orange-100 text-orange-700",
  COMPILE_ERROR: "bg-yellow-100 text-yellow-700",
  PRESENTATION_ERROR: "bg-pink-100 text-pink-700",
  SYSTEM_ERROR: "bg-gray-200 text-gray-700",
  PENDING: "bg-blue-100 text-blue-700",
  JUDGING: "bg-cyan-100 text-cyan-700",
};

function verdictClass(verdict: string) {
  return VERDICT_COLORS[verdict] ?? "bg-gray-100 text-gray-700";
}

const CHART_W = 640;
const CHART_H = 180;
const CHART_PAD_TOP = 10;
const CHART_PAD_BOTTOM = 26;
const CHART_PAD_X = 2;

function SubmissionsChart({ minutes }: { minutes: MonitorMinuteBucket[] }) {
  const plotW = CHART_W - CHART_PAD_X * 2;
  const plotH = CHART_H - CHART_PAD_TOP - CHART_PAD_BOTTOM;
  const slot = plotW / minutes.length;
  const barW = Math.max(1, slot * 0.7);
  const maxCount = Math.max(1, ...minutes.map((m) => m.count));

  // 每 10 分钟一个 x 轴标签
  const labelIdx = minutes
    .map((_, i) => i)
    .filter((i) => i % 10 === 0);

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      className="w-full"
      role="img"
      aria-label="Submissions per minute (last 60 minutes)"
    >
      {/* 顶部分钟刻度线 */}
      <line
        x1={CHART_PAD_X}
        y1={CHART_PAD_TOP}
        x2={CHART_W - CHART_PAD_X}
        y2={CHART_PAD_TOP}
        stroke="#e5e7eb"
        strokeWidth="1"
      />
      {minutes.map((m, i) => {
        const x = CHART_PAD_X + i * slot + (slot - barW) / 2;
        const h = m.count > 0 ? Math.max(2, (m.count / maxCount) * plotH) : 1;
        const y = CHART_PAD_TOP + plotH - h;
        const isPeak = m.count > 0 && m.count === maxCount;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={h}
            rx="1"
            fill={isPeak ? "#2563eb" : m.count > 0 ? "#93c5fd" : "#e5e7eb"}
          >
            <title>{`${m.minute} — ${m.count} submissions`}</title>
          </rect>
        );
      })}
      {labelIdx.map((i) => (
        <text
          key={i}
          x={CHART_PAD_X + i * slot + slot / 2}
          y={CHART_H - 8}
          textAnchor="middle"
          fontSize="9"
          fill="#9ca3af"
        >
          {minutes[i].minute}
        </text>
      ))}
    </svg>
  );
}

export default function MonitorClient({
  initial,
}: {
  initial: MonitorStats;
}) {
  const [data, setData] = useState<MonitorStats>(initial);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  useEffect(() => {
    let stopped = false;

    async function poll() {
      try {
        const res = await fetch("/api/admin/monitor", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as MonitorStats;
        if (!stopped) {
          setData(json);
          setLastUpdated(Date.now());
        }
      } catch {
        // 网络抖动时保留上一次数据
      }
    }

    poll();
    const timer = setInterval(poll, 10_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  const { queue, workers, minutes, verdicts } = data;
  const maxPerMinute = Math.max(0, ...minutes.map((m) => m.count));

  const cards = [
    {
      label: "Queue Waiting",
      value: queue?.waiting ?? 0,
      icon: QueueListIcon,
      color: queue && queue.waiting > 0 ? "text-amber-600" : "text-gray-500",
    },
    {
      label: "Queue Active",
      value: queue?.active ?? 0,
      icon: ClockIcon,
      color: "text-blue-600",
    },
    {
      label: "Workers Online",
      value: workers.length,
      icon: ServerIcon,
      color: workers.length > 0 ? "text-green-600" : "text-red-600",
    },
    {
      label: "Active Teams (10 min)",
      value: data.onlineTeams,
      icon: UsersIcon,
      color: "text-orange-600",
    },
    {
      label: "Submissions (1 h)",
      value: data.submissionsLastHour,
      icon: ChartBarIcon,
      color: "text-green-600",
    },
    {
      label: "Running Contests",
      value: data.runningContests,
      icon: TrophyIcon,
      color: "text-purple-600",
    },
  ];

  return (
    <div className="space-y-8">
      {/* 指标卡片 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {cards.map((card) => (
          <div
            key={card.label}
            className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-3"
          >
            <card.icon className={`w-6 h-6 ${card.color} shrink-0`} />
            <div className="min-w-0">
              <div className="text-xl font-bold text-gray-900 leading-none">
                {card.value}
              </div>
              <div className="text-[11px] font-medium text-gray-500 mt-1 truncate">
                {card.label}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 提交曲线 */}
      <div className="bg-white shadow-sm rounded-xl border border-gray-200 p-6">
        <div className="flex flex-wrap justify-between items-center gap-2 mb-2">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <ChartBarIcon className="w-5 h-5 text-gray-500" />
            Submissions / Minute (last 60 min)
          </h3>
          <span className="text-xs text-gray-400 flex items-center gap-2">
            <span>
              Peak: <b className="text-gray-600">{maxPerMinute}/min</b>
            </span>
            <span>
              {lastUpdated === null
                ? "refreshing…"
                : `updated ${new Date(lastUpdated).toLocaleTimeString()}`}
            </span>
            <ArrowPathIcon className="w-3.5 h-3.5 animate-spin [animation-duration:3s]" />
          </span>
        </div>
        {data.submissionsLastHour === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400 border border-dashed border-gray-200 rounded-lg">
            No submissions in the last hour.
          </div>
        ) : (
          <SubmissionsChart minutes={minutes} />
        )}
      </div>

      {/* 判定结果分布 */}
      <div className="bg-white shadow-sm rounded-xl border border-gray-200 p-6">
        <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
          <QueueListIcon className="w-5 h-5 text-gray-500" />
          Verdict Distribution (last 60 min)
        </h3>
        {verdicts.length === 0 ? (
          <div className="text-sm text-gray-400">No data.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {verdicts.map((v) => (
              <span
                key={v.verdict}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold ${verdictClass(
                  v.verdict,
                )}`}
              >
                {v.verdict}
                <span className="opacity-70">{v.count}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
