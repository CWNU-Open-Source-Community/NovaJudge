import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { getGlobalSubmissions } from "./actions";
import Pagination from "@/components/admin/AdminPagination";
import { AdminPageHeader, AdminTable } from "@/components/admin/AdminPage";
import { createAdminLocale } from "@/lib/admin-locale";
import { getLanguage } from "@/lib/get-dictionary";
import Link from "next/link";
import RejudgeButton from "@/components/admin/RejudgeButton";
import RejudgeBatchPanel from "@/components/admin/RejudgeBatchPanel";
import VerdictCell from "@/components/VerdictCell";

export default async function GlobalSubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; problem?: string; team?: string }>;
}) {
  const { page, problem, team } = await searchParams;
  const currentPage = Number(page) || 1;
  const pageSize = 15;
  const problemQuery = problem?.trim() || "";
  const teamQuery = team?.trim() || "";

  const { submissions, total } = await getGlobalSubmissions(
    currentPage,
    pageSize,
    problemQuery,
    teamQuery,
  );

  const { t, locale } = createAdminLocale(await getLanguage());
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="space-y-5">
      <AdminPageHeader title={t("Global Submissions", "全站提交记录")} description={t("Find submissions across contests, inspect results, and rejudge when needed.", "按题目或队伍查找提交，查看结果并发起重判。")} />

      <RejudgeBatchPanel />

      <section className="admin-card overflow-hidden">
        <form role="search" className="grid gap-3 p-3.5 sm:grid-cols-2 sm:p-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-end">
          <label className="grid gap-1.5 text-sm font-medium text-gray-700">
            {t("Problem", "题目")}
            <input type="search" name="problem" defaultValue={problemQuery} placeholder={t("Problem ID or title", "题目 ID 或标题")} className="admin-input" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-gray-700">
            {t("Team or user", "队伍或用户")}
            <input type="search" name="team" defaultValue={teamQuery} placeholder={t("Team, username, school, or seat", "队名、账号、学校或座位号")} className="admin-input" />
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-1">
            <button type="submit" className="admin-button admin-button-primary">
              <MagnifyingGlassIcon className="size-4" aria-hidden="true" />
              {t("Search", "搜索")}
            </button>
            {(problemQuery || teamQuery) && <Link href="/admin/submissions" className="admin-button">{t("Reset", "重置")}</Link>}
          </div>
        </form>
        <AdminTable label={t("Submissions", "提交列表")} className="min-w-[43rem]">
          <thead>
            <tr>
              <th scope="col">{t("Submission", "提交")}</th>
              <th scope="col">{t("User", "用户")}</th>
              <th scope="col">{t("Problem", "题目")}</th>
              <th scope="col">{t("Verdict", "结果")}</th>
              <th scope="col">{t("Time / memory", "时间 / 内存")}</th>
              <th scope="col" className="text-right">{t("Actions", "操作")}</th>
            </tr>
          </thead>
          <tbody>
            {submissions.map((sub) => {
              const username = sub.user?.username ?? sub.globalUser?.username;
              const displayName = sub.user?.displayName ?? sub.globalUser?.displayName;
              const source = sub.contest ? t(`Contest #${sub.contest.id}`, `比赛 #${sub.contest.id}`) : t("Admin test", "后台测试");

              return (
                <tr key={sub.id}>
                  <th scope="row" className="min-w-36 align-top font-normal">
                    <Link href={`/admin/submissions/${sub.id}`} className="admin-text-link inline-flex items-center gap-2">
                      <span className="font-mono text-xs" title={sub.id}>#{sub.id.slice(0, 8)}</span>
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs uppercase text-gray-700">{sub.language}</span>
                    </Link>
                    <time dateTime={sub.submittedAt.toISOString()} className="mt-1.5 block text-xs text-gray-600">{dateFormat.format(sub.submittedAt)}</time>
                  </th>
                  <td className="min-w-32 align-top">
                    <div className="wrap-break-word font-medium text-gray-900">{displayName || username || t("Unknown", "未知")}</div>
                    {displayName && username && <div className="text-xs text-gray-600">@{username}</div>}
                    <div className="mt-1 text-xs text-gray-600">{source}</div>
                    {sub.contest && sub.user && (
                      <Link href={`/contest/${sub.contest.id}/status?viewAll=true&userId=${encodeURIComponent(sub.user.id)}`} className="admin-text-link text-xs">
                        {t("View team submissions", "查看该队提交")}
                      </Link>
                    )}
                  </td>
                  <td className="min-w-28 align-top">
                    <Link href={`/admin/problems/${sub.problemId}/test`} className="admin-text-link wrap-break-word">{sub.problem.title}</Link>
                  </td>
                  <td className="align-top"><VerdictCell submission={sub} /></td>
                  <td className="whitespace-nowrap align-top text-xs tabular-nums text-gray-600">
                    {sub.timeUsed !== null ? `${sub.timeUsed} ms` : "—"} / {sub.memoryUsed !== null ? `${sub.memoryUsed} KB` : "—"}
                  </td>
                  <td className="text-right align-top"><RejudgeButton submissionId={sub.id} verdict={sub.verdict} /></td>
                </tr>
              );
            })}
            {submissions.length === 0 && <tr><td colSpan={6} className="text-center"><p className="py-7 text-sm text-gray-600">{t("No matching submissions.", "没有符合条件的提交。")}</p></td></tr>}
          </tbody>
        </AdminTable>
        <div className="admin-table-footer"><Pagination totalItems={total} pageSize={pageSize} /></div>
      </section>
    </div>
  );
}
