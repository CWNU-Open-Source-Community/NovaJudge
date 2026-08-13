import Link from "next/link";
import { getContests } from "./contests/actions";
import { getSystemStats, getSupportedLanguages, getJudgeWorkersOverview } from "./actions";
import JudgeWorkers from "./JudgeWorkers";
import {
  PlusIcon,
  TrophyIcon,
  ServerIcon,
  CpuChipIcon,
  UsersIcon,
  DocumentTextIcon,
  ClockIcon,
  ChartBarIcon,
  CommandLineIcon,
} from "@heroicons/react/24/outline";

export const dynamic = "force-dynamic";

// 格式化字节大小
function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KiB", "MiB", "GiB", "TiB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

// 格式化运行时间
function formatUptime(seconds: number) {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

export default async function AdminDashboard() {
  const { contests } = await getContests(1, 5);
  const stats = await getSystemStats();
  const languages = await getSupportedLanguages();
  const judgeWorkers = await getJudgeWorkersOverview();

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* 顶部欢迎区 */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
            Dashboard
          </h1>
          <p className="text-gray-500 mt-2">
            Overview of system status and recent activities.
          </p>
        </div>
        <Link
          href="/admin/contests/create"
          className="inline-flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-lg shadow hover:bg-blue-700 transition-colors font-medium text-sm"
        >
          <PlusIcon className="w-5 h-5" />
          Create Contest
        </Link>
      </div>

      {/* 核心指标卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          {
            label: "Contests",
            value: stats.counts.contests,
            icon: TrophyIcon,
            color: "text-purple-600",
            bg: "bg-purple-50",
          },
          {
            label: "Problems",
            value: stats.counts.problems,
            icon: DocumentTextIcon,
            color: "text-blue-600",
            bg: "bg-blue-50",
          },
          {
            label: "Submissions",
            value: stats.counts.submissions,
            icon: ChartBarIcon,
            color: "text-green-600",
            bg: "bg-green-50",
          },
          {
            label: "Users",
            value: stats.counts.users,
            icon: UsersIcon,
            color: "text-orange-600",
            bg: "bg-orange-50",
          },
        ].map((item) => (
          <div
            key={item.label}
            className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4"
          >
            <div className={`p-3 rounded-lg ${item.bg}`}>
              <item.icon className={`w-6 h-6 ${item.color}`} />
            </div>
            <div>
              <div className="text-sm font-medium text-gray-500">
                {item.label}
              </div>
              <div className="text-2xl font-bold text-gray-900">
                {item.value}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* 左侧：最近比赛列表 */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white shadow-sm rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <TrophyIcon className="w-5 h-5 text-gray-500" />
                Recent Contests
              </h3>
              <Link
                href="/admin/contests"
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                View All →
              </Link>
            </div>

            {contests.length === 0 ? (
              <div className="p-12 text-center text-gray-400">
                No contests found.
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {contests.map((c) => (
                  <div
                    key={c.id}
                    className="p-6 hover:bg-gray-50 transition-colors group"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-3">
                        <span
                          className={`px-2 py-0.5 text-xs font-bold rounded uppercase ${
                            c.status === "RUNNING"
                              ? "bg-green-100 text-green-700"
                              : c.status === "ENDED"
                                ? "bg-gray-100 text-gray-600"
                                : "bg-yellow-50 text-yellow-700"
                          }`}
                        >
                          {c.status}
                        </span>
                        <h4 className="font-bold text-gray-900 group-hover:text-blue-600 transition-colors">
                          {c.title}
                        </h4>
                      </div>
                      <span className="text-xs font-mono text-gray-400">
                        #{c.id}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-gray-500 mb-4">
                      <div className="flex items-center gap-1">
                        <ClockIcon className="w-4 h-4" />
                        {new Date(c.startTime).toLocaleString()}
                      </div>
                      <span className="text-gray-300">|</span>
                      <span>{c.type}</span>
                    </div>

                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                      <Link
                        href={`/admin/contests/${c.id}/problems`}
                        className="text-xs font-medium px-3 py-1.5 bg-white border border-gray-200 rounded hover:border-blue-300 hover:text-blue-600 transition-colors"
                      >
                        Problems
                      </Link>
                      <Link
                        href={`/admin/contests/${c.id}/users`}
                        className="text-xs font-medium px-3 py-1.5 bg-white border border-gray-200 rounded hover:border-purple-300 hover:text-purple-600 transition-colors"
                      >
                        Users
                      </Link>
                      <Link
                        href={`/admin/contests/${c.id}/edit`}
                        className="text-xs font-medium px-3 py-1.5 bg-white border border-gray-200 rounded hover:border-gray-400 hover:text-gray-900 transition-colors"
                      >
                        Settings
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 右侧：系统状态 */}
        <div className="space-y-6">
          {/* 判题机列表（多开时每台判题机一个 ID） */}
          <JudgeWorkers initial={judgeWorkers} />

          {/* 判题沙箱状态 */}
          <div className="bg-white shadow-sm rounded-xl border border-gray-200 p-6">
            <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
              <ServerIcon className="w-5 h-5 text-gray-500" />
              Judge Server Status
            </h3>

            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-100">
              <div className="flex items-center gap-3">
                <div className="relative flex h-3 w-3">
                  <span
                    className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${stats.judge.status === "online" ? "bg-green-400" : "bg-red-400"}`}
                  ></span>
                  <span
                    className={`relative inline-flex rounded-full h-3 w-3 ${stats.judge.status === "online" ? "bg-green-500" : "bg-red-500"}`}
                  ></span>
                </div>
                <span className="font-medium text-sm text-gray-700">
                  Go-Judge Core
                </span>
              </div>
              <span
                className={`text-xs font-bold px-2 py-1 rounded ${
                  stats.judge.status === "online"
                    ? "bg-green-100 text-green-700"
                    : "bg-red-100 text-red-700"
                }`}
              >
                {stats.judge.status === "online" ? "ONLINE" : "OFFLINE"}
              </span>
            </div>

            {stats.judge.version !== "N/A" && (
              <div className="mt-2 text-xs text-gray-400 text-right">
                Version: {stats.judge.version}
              </div>
            )}
          </div>

          {/* 服务器资源监控 */}
          <div className="bg-white shadow-sm rounded-xl border border-gray-200 p-6">
            <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
              <CpuChipIcon className="w-5 h-5 text-gray-500" />
              System Resources
            </h3>

            <div className="space-y-4">
              {/* CPU */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-500">
                    {stats.system.platform === "win32"
                      ? "CPU Cores"
                      : "CPU Load (1m/5m/15m)"}
                  </span>
                </div>
                {stats.system.platform === "win32" ? (
                  <div className="bg-blue-50 text-blue-700 text-center py-2 rounded text-xs font-mono font-bold">
                    {stats.system.cpuCount} Cores Available (Load Average N/A on
                    Windows)
                  </div>
                ) : (
                  <div className="flex gap-2">
                    {stats.system.loadAvg.map((load: number, i: number) => (
                      <div
                        key={i}
                        className="flex-1 bg-blue-50 text-blue-700 text-center py-1 rounded text-xs font-mono font-bold"
                      >
                        {load.toFixed(2)}
                      </div>
                    ))}
                  </div>
                )}
                <div
                  className="mt-1 text-[10px] text-gray-400 truncate"
                  title={stats.system.cpuModel}
                >
                  {stats.system.cpuModel}
                </div>
              </div>

              {/* Memory */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-500">Memory Usage</span>
                  <span className="text-gray-700 font-medium">
                    {formatBytes(stats.system.memory.used)} /{" "}
                    {formatBytes(stats.system.memory.total)}
                  </span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-500 rounded-full"
                    style={{
                      width: `${(stats.system.memory.used / stats.system.memory.total) * 100}%`,
                    }}
                  />
                </div>
              </div>

              {/* Uptime */}
              <div className="pt-4 border-t border-gray-100 flex justify-between items-center text-xs">
                <span className="text-gray-500">System Uptime</span>
                <span className="font-mono text-gray-700 font-medium">
                  {formatUptime(stats.system.uptime)}
                </span>
              </div>
            </div>
          </div>

          {/* 支持的语言列表 */}
          <div className="bg-white shadow-sm rounded-xl border border-gray-200 p-6">
            <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
              <CommandLineIcon className="w-5 h-5 text-gray-500" />
              Supported Languages
            </h3>

            <div className="space-y-4">
              {Object.entries(languages).map(([key, config]) => (
                <div
                  key={key}
                  className="bg-gray-50 rounded-lg p-4 border border-gray-100"
                >
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-bold text-gray-800 uppercase bg-white border border-gray-200 px-2 py-0.5 rounded text-xs shadow-sm">
                      {key}
                    </span>
                    <span className="text-xs text-gray-400 font-mono">
                      {config.srcName}
                    </span>
                  </div>

                  {config.compileCmd && (
                    <div className="mb-2">
                      <div className="text-[10px] uppercase text-gray-400 font-bold mb-1">
                        Compile Command
                      </div>
                      <code className="block bg-gray-100 text-gray-600 text-[10px] p-2 rounded border border-gray-200 font-mono break-all">
                        {config.compileCmd.join(" ")}
                      </code>
                    </div>
                  )}

                  <div>
                    <div className="text-[10px] uppercase text-gray-400 font-bold mb-1">
                      Run Command
                    </div>
                    <code className="block bg-gray-100 text-gray-600 text-[10px] p-2 rounded border border-gray-200 font-mono break-all">
                      {config.runCmd.join(" ")}
                    </code>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
