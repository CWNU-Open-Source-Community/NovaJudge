import Link from "next/link";
import {
  ArrowDownTrayIcon,
  ArrowRightIcon,
  ChartBarIcon,
  ClockIcon,
  CommandLineIcon,
  CpuChipIcon,
  DocumentTextIcon,
  PlusIcon,
  ServerIcon,
  TrophyIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";
import { AdminContestStatus, AdminPageHeader } from "@/components/admin/AdminPage";
import { createAdminLocale } from "@/lib/admin-locale";
import { getLanguage } from "@/lib/get-dictionary";
import { getContests } from "./contests/actions";
import { getJudgeWorkersOverview, getSupportedLanguages, getSystemStats } from "./actions";
import JudgeWorkers from "./JudgeWorkers";

export const dynamic = "force-dynamic";

function formatBytes(bytes: number, locale: string) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const unit = bytes > 0 ? Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1) : 0;
  return `${(bytes / 1024 ** unit).toLocaleString(locale, { maximumFractionDigits: 2 })} ${units[unit]}`;
}

export default async function AdminDashboard() {
  const [{ contests }, stats, languages, judgeWorkers, language] = await Promise.all([
    getContests(1, 5),
    getSystemStats(),
    getSupportedLanguages(),
    getJudgeWorkersOverview(),
    getLanguage(),
  ]);
  const { t, locale } = createAdminLocale(language);
  const counts = [
    { label: t("Contests", "比赛"), value: stats.counts.contests, icon: TrophyIcon, color: "bg-purple-50 text-purple-600" },
    { label: t("Problems", "题目"), value: stats.counts.problems, icon: DocumentTextIcon, color: "bg-blue-50 text-blue-600" },
    { label: t("Submissions", "提交"), value: stats.counts.submissions, icon: ChartBarIcon, color: "bg-green-50 text-green-600" },
    { label: t("Site accounts", "站点账号"), value: stats.counts.users, icon: UsersIcon, color: "bg-orange-50 text-orange-600" },
  ];
  const isJudgeOnline = stats.judge.status === "online";
  const memoryPercent = stats.system.memory.total > 0
    ? Math.round(100 * stats.system.memory.used / stats.system.memory.total)
    : 0;
  const uptimeMinutes = Math.floor(stats.system.uptime / 60);
  const days = Math.floor(uptimeMinutes / 1440);
  const hours = Math.floor(uptimeMinutes / 60) % 24;
  const minutes = uptimeMinutes % 60;
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="space-y-5 sm:space-y-6">
      <AdminPageHeader title={t("Dashboard", "仪表盘")} description={t("Contest activity and judging health at a glance.", "查看近期比赛、判题队列和服务器状态。")}>
        <Link href="/admin/problems/import" className="admin-button">
          <ArrowDownTrayIcon className="size-4" aria-hidden="true" />
          {t("Import problems", "导入题目")}
        </Link>
        <Link href="/admin/contests/create" className="admin-button admin-button-primary">
          <PlusIcon className="size-4" aria-hidden="true" />
          {t("Create contest", "创建比赛")}
        </Link>
      </AdminPageHeader>

      <dl className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {counts.map((item) => (
          <div key={item.label} className="admin-card flex min-w-0 flex-wrap items-start gap-x-3 gap-y-2 p-3.5 sm:p-4 xl:p-5">
            <span className={`grid size-9 shrink-0 place-items-center rounded-lg sm:size-10 ${item.color}`}>
              <item.icon className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <dt className="text-xs font-medium text-gray-600 sm:text-sm">{item.label}</dt>
              <dd className="mt-1 wrap-break-word text-xl font-semibold tracking-tight tabular-nums text-gray-900 sm:text-2xl">{item.value.toLocaleString(locale)}</dd>
            </div>
          </div>
        ))}
      </dl>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] xl:gap-5">
        <section className="admin-card overflow-hidden" aria-labelledby="recent-contests-heading">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3.5 sm:px-5">
            <h2 id="recent-contests-heading" className="text-base font-semibold text-gray-900">{t("Recent contests", "近期比赛")}</h2>
            <Link href="/admin/contests" className="admin-text-link inline-flex items-center gap-1.5 text-sm">
              {t("All contests", "全部比赛")}
              <ArrowRightIcon className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
          {contests.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-gray-600">{t("No contests yet.", "目前没有比赛。")}</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {contests.map((contest) => (
                <li key={contest.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 hover:bg-gray-50 sm:px-5">
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link href={`/admin/contests/${contest.id}/edit`} className="admin-text-link wrap-break-word text-sm font-semibold">
                        {contest.title}
                      </Link>
                      <AdminContestStatus status={contest.status} lang={language} />
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-gray-600">
                      <span className="font-mono">#{contest.id}</span>
                      <span className="inline-flex items-center gap-1">
                        <ClockIcon className="size-3.5 shrink-0" aria-hidden="true" />
                        <time dateTime={contest.startTime.toISOString()}>{dateFormat.format(contest.startTime)}</time>
                      </span>
                      <span>{contest.type === "PUBLIC" ? t("Public", "公开") : t("Private", "私有")}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <Link href={`/admin/contests/${contest.id}/problems`} className="admin-button admin-button-small">{t("Problems", "题目")}</Link>
                    <Link href={`/admin/contests/${contest.id}/users`} className="admin-button admin-button-small">{t("Users", "账号")}</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <JudgeWorkers initial={judgeWorkers} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2 xl:gap-5">
        <section className="admin-card p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
            <CpuChipIcon className="size-5 text-gray-500" aria-hidden="true" />
            {t("System resources", "服务器资源")}
          </h2>
          <dl className="mt-4 space-y-4 text-sm">
            <div>
              <dt className="font-medium text-gray-700">{stats.system.platform === "win32" ? t("CPU cores", "CPU 核心") : t("CPU load (1 / 5 / 15 min)", "CPU 负载（1 / 5 / 15 分钟）")}</dt>
              <dd className="mt-2">
                {stats.system.platform === "win32" ? (
                  <span className="rounded-md bg-blue-50 px-2 py-1 font-mono text-blue-700">{stats.system.cpuCount}</span>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {stats.system.loadAvg.map((load, index) => (
                      <span key={index} className="rounded-md bg-blue-50 px-2 py-1 text-center font-mono text-xs text-blue-700">{load.toFixed(2)}</span>
                    ))}
                  </div>
                )}
                <p className="mt-1.5 wrap-break-word text-xs text-gray-600">{stats.system.cpuModel}</p>
              </dd>
            </div>
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <dt className="font-medium text-gray-700">{t("Memory usage", "内存用量")}</dt>
                <dd className="font-mono text-xs text-gray-700">{formatBytes(stats.system.memory.used, locale)} / {formatBytes(stats.system.memory.total, locale)}</dd>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100" role="meter" aria-label={t("Memory usage", "内存用量")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={memoryPercent}>
                <div className="h-full rounded-full bg-purple-500" style={{ width: `${memoryPercent}%` }} />
              </div>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-gray-100 pt-4">
              <dt className="font-medium text-gray-700">{t("System uptime", "运行时间")}</dt>
              <dd className="font-mono text-xs text-gray-700">{t(`${days}d ${hours}h ${minutes}m`, `${days} 天 ${hours} 小时 ${minutes} 分钟`)}</dd>
            </div>
          </dl>
        </section>

        <section className="admin-card overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 p-4 sm:px-5">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
                <ServerIcon className="size-5 text-gray-500" aria-hidden="true" />
                {t("Judge sandbox", "判题沙箱")}
              </h2>
              <p className="mt-1 text-xs text-gray-600">go-judge{stats.judge.version !== "N/A" && ` · ${stats.judge.version}`}</p>
            </div>
            <span className={`rounded-md px-2 py-1 text-xs font-semibold ${isJudgeOnline ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
              {isJudgeOnline ? t("Online", "在线") : t("Offline", "离线")}
            </span>
          </div>
          <div className="p-4 sm:px-5">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900">
              <CommandLineIcon className="size-4 text-gray-500" aria-hidden="true" />
              {t("Supported languages", "支持的语言")}
            </h3>
            <div className="divide-y divide-gray-100">
              {Object.entries(languages).map(([key, config]) => (
                <details key={key} className="py-1.5">
                  <summary className="cursor-pointer rounded-sm px-1 py-1 text-sm font-medium text-gray-700">
                    <span className="ml-1 uppercase">{key}</span>
                    <code className="ml-2 text-xs text-gray-600">{config.srcName}</code>
                  </summary>
                  <dl className="space-y-2 px-2 pt-2 pb-3 text-xs">
                    {config.compileCmd && (
                      <div>
                        <dt className="mb-1 font-medium text-gray-700">{t("Compile command", "编译命令")}</dt>
                        <dd><code className="block wrap-break-word rounded-md bg-gray-100 p-2 text-gray-700">{config.compileCmd.join(" ")}</code></dd>
                      </div>
                    )}
                    <div>
                      <dt className="mb-1 font-medium text-gray-700">{t("Run command", "运行命令")}</dt>
                      <dd><code className="block wrap-break-word rounded-md bg-gray-100 p-2 text-gray-700">{config.runCmd.join(" ")}</code></dd>
                    </div>
                  </dl>
                </details>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
