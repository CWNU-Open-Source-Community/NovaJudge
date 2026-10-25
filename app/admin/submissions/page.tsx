import { getGlobalSubmissions } from "./actions";
import Pagination from "@/components/Pagination";
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

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">
        Global Submissions
      </h1>

      <RejudgeBatchPanel />

      <form className="mb-4 flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm md:flex-row md:items-end">
        <div className="flex-1">
          <label className="mb-2 block text-sm font-bold text-gray-700">
            Filter by Problem
          </label>
          <input
            type="text"
            name="problem"
            defaultValue={problemQuery}
            placeholder="Problem ID or title"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>
        <div className="flex-1">
          <label htmlFor="team-search" className="mb-2 block text-sm font-bold text-gray-700">
            队伍 / 用户
          </label>
          <input
            id="team-search"
            type="search"
            name="team"
            defaultValue={teamQuery}
            placeholder="队名、账号、学校或座位号"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700"
        >
          Search
        </button>
        {(problemQuery || teamQuery) && (
          <Link
            href="/admin/submissions"
            className="rounded-md border border-gray-300 px-4 py-2 text-center text-sm font-bold text-gray-700 transition hover:bg-gray-50"
          >
            Reset
          </Link>
        )}
      </form>

      <div className="bg-white shadow rounded-lg overflow-hidden border border-gray-200">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-600">
            <thead className="bg-gray-50 text-gray-700 font-bold border-b uppercase text-xs">
              <tr>
                <th className="px-6 py-3">ID</th>
                <th className="px-6 py-3">When</th>
                <th className="px-6 py-3">User</th>
                <th className="px-6 py-3">Problem</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Time/Mem</th>
                <th className="px-6 py-3">Lang</th>
                <th className="px-6 py-3">Source</th>
                <th className="px-6 py-3">Setting</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {submissions.map((sub) => {
                // 判断是谁提交的
                const submitter = sub.user?.username
                  ? `User: ${sub.user.username}`
                  : sub.globalUser?.username
                  ? `Admin: ${sub.globalUser.username}`
                  : "Unknown";

                const fromContest = sub.contest
                  ? `(Contest #${sub.contest.id})`
                  : "(Problem Bank)";

                return (
                  <tr key={sub.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-mono text-xs">
                      {sub.id.slice(0, 8)}...
                    </td>
                    <td className="px-6 py-4">
                      {new Date(sub.submittedAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">
                        {sub.user?.displayName || sub.globalUser?.displayName || submitter}
                      </div>
                      {(sub.user?.displayName || sub.globalUser?.displayName) && (
                        <div className="text-xs text-gray-500">{submitter}</div>
                      )}
                      <div className="text-xs text-gray-400">{fromContest}</div>
                      {sub.contest && sub.user && (
                        <Link
                          href={`/contest/${sub.contest.id}/status?viewAll=true&userId=${encodeURIComponent(sub.user.id)}`}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          在比赛中管理该队提交
                        </Link>
                      )}
                    </td>
                    <td className="px-6 py-4 text-blue-600">
                      <Link href={`/admin/problems/${sub.problemId}/test`}>
                        {sub.problem.title}
                      </Link>
                    </td>
                    <td className="px-6 py-4">
                      <VerdictCell submission={sub} />
                    </td>
                    <td className="px-6 py-4">
                      {sub.timeUsed !== null ? `${sub.timeUsed}ms` : "-"} /{" "}
                      {sub.memoryUsed !== null ? `${sub.memoryUsed}KB` : "-"}
                    </td>
                    <td className="px-6 py-4 uppercase">
                      <Link
                        href={`/admin/submissions/${sub.id}`}
                        className="text-blue-600 hover:text-blue-800 hover:underline font-bold"
                      >
                        {sub.language}
                      </Link>
                    </td>
                    <td className="px-6 py-4">
                      {sub.contest ? "Contest Source" : "Admin Test"}
                    </td>
                    <td className="px-6 py-4">
                      <RejudgeButton submissionId={sub.id} verdict={sub.verdict} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 分页组件 */}
        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <Pagination totalItems={total} pageSize={pageSize} />
        </div>
      </div>
    </div>
  );
}
