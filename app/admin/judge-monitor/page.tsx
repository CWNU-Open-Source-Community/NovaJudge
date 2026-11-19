import { createAdminLocale } from "@/lib/admin-locale";
import { getLanguage } from "@/lib/get-dictionary";
import { getMonitorStats } from "@/lib/monitor";
import JudgeWorkers from "../JudgeWorkers";
import MonitorClient from "./MonitorClient";
import { AdminPageHeader } from "@/components/admin/AdminPage";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = createAdminLocale(await getLanguage());
  return { title: t("Judge Monitor", "判题监控") };
}

export default async function JudgeMonitorPage() {
  const { t } = createAdminLocale(await getLanguage());
  const stats = await getMonitorStats();

  return (
    <div className="space-y-5 sm:space-y-6">
      <AdminPageHeader title={t("Judge Monitor", "判题监控")} description={t("Inspect the judge queue, submission activity, and verdicts.", "查看判题队列、提交走势和结果分布。")} />

      <MonitorClient initial={stats} />
      <JudgeWorkers initial={{ workers: stats.workers, queue: stats.queue }} />
    </div>
  );
}
