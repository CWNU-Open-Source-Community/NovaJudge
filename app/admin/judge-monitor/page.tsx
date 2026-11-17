import { getMonitorStats } from "@/lib/monitor";
import JudgeWorkers from "../JudgeWorkers";
import MonitorClient from "./MonitorClient";
import { SignalIcon } from "@heroicons/react/24/outline";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Judge Monitor - NovaJudge Admin",
};

export default async function JudgeMonitorPage() {
  const stats = await getMonitorStats();

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight flex items-center gap-3">
          <SignalIcon className="w-8 h-8 text-blue-600" />
          Judge Monitor
        </h1>
        <p className="text-gray-500 mt-2">
          Real-time overview of the judge pipeline and contest activity.
        </p>
      </div>

      <MonitorClient initial={stats} />
      <JudgeWorkers initial={{ workers: stats.workers, queue: stats.queue }} />
    </div>
  );
}
