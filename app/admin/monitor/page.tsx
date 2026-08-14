import { getMonitorStats } from "@/lib/monitor";
import JudgeWorkers from "../JudgeWorkers";
import MonitorClient from "./MonitorClient";
import { SignalIcon } from "@heroicons/react/24/outline";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Monitor - NovaJudge Admin",
};

export default async function MonitorPage() {
  const stats = await getMonitorStats();

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* 顶部标题 */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight flex items-center gap-3">
          <SignalIcon className="w-8 h-8 text-blue-600" />
          Monitor
        </h1>
        <p className="text-gray-500 mt-2">
          Real-time overview of the judge pipeline and contest activity.
        </p>
      </div>

      {/* 指标 + 提交曲线 + 判定分布（客户端 10 秒轮询） */}
      <MonitorClient initial={stats} />

      {/* 判题机列表（复用现有组件，5 秒轮询） */}
      <JudgeWorkers
        initial={{ workers: stats.workers, queue: stats.queue }}
      />
    </div>
  );
}
