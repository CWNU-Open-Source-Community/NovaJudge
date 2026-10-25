"use client";

import Link from "next/link";

interface Team {
  rank: number | string;
  medal?: "Gold" | "Silver" | "Bronze" | "";
  id: string;
  contestUserId?: string;
  username: string;
  displayName: string | null;
  members: string | null;
  school: string | null;
  category: string | null;
  isVirtual?: boolean;
  solved: number;
  penalty: number;
  problems: Array<{
    problemId: number;
    displayId: string;
    color: string | null;
    firstBlood: boolean;
    accepted: boolean;
    time: string;
    tries: number;
    frozenTries: number;
    unfrozenTries: number;
    firstAcceptedSubmissionId?: number;
    upsolved: boolean;
  } | null>;
}

interface ContestProblem {
  problemId: number;
  displayId: string;
  color: string | null;
}

interface RankTableProps {
  contestId: string;
  teams: Team[];
  isMyTeam: boolean;
  isContestEnded: boolean;
  canManageSubmissions: boolean;
  contestProblems: ContestProblem[];
  isFrozen: boolean;
  teamColumnWidthPercent: number;
}

export default function RankTable({
  contestId,
  teams,
  isMyTeam,
  isContestEnded,
  canManageSubmissions,
  contestProblems,
  isFrozen,
  teamColumnWidthPercent,
}: RankTableProps) {
  const rankColumnWidthPercent = 5;
  const solvedColumnWidthPercent = 6;
  const penaltyColumnWidthPercent = 7;
  const problemColumnWidthPercent =
    contestProblems.length > 0
      ? (100 -
          rankColumnWidthPercent -
          teamColumnWidthPercent -
          solvedColumnWidthPercent -
          penaltyColumnWidthPercent) /
        contestProblems.length
      : 0;
  const tableMinWidth = Math.max(760, 360 + contestProblems.length * 64);

  // 获取单元格背景色
  const getCellColor = (prob: Team["problems"][0]) => {
    if (!prob) return "";

    // 1. 优先判断是否AC (Green)
    if (prob.accepted) {
      if (prob.firstBlood) return "bg-[#1b5e20] text-white";
      return "bg-[#4caf50] text-white";
    }

    if (prob.upsolved) {
      return "bg-blue-400 text-white";
    }

    // 2. 判断是否有封榜后的提交 (Blue)
    if (prob.frozenTries > 0) {
      return "bg-blue-600 text-white"; // 整个背景深蓝色，或者用浅蓝背景深蓝字
    }

    // 3. 判断是否有错误尝试 (Red)
    if (prob.tries > 0) {
      return "bg-[#d32f2f] text-white";
    }

    return "text-white";
  };

  const getRankCellColor = (team: Team) => {
    if (team.category === "1" || team.rank === "*") return "bg-transparent";
    if (team.medal === "Gold") return "bg-yellow-300 text-yellow-950";
    if (team.medal === "Silver") return "bg-slate-300 text-slate-950";
    if (team.medal === "Bronze") return "bg-amber-700 text-white";
    return "text-gray-900";
  };

  return (
    <div className="w-full overflow-x-auto overscroll-x-contain">
      <table
        className="w-full table-fixed border-collapse text-center text-xs"
        style={{ minWidth: `${tableMinWidth}px` }}
      >
        <colgroup>
          <col style={{ width: `${rankColumnWidthPercent}%` }} />
          <col style={{ width: `${teamColumnWidthPercent}%` }} />
          <col style={{ width: `${solvedColumnWidthPercent}%` }} />
          <col style={{ width: `${penaltyColumnWidthPercent}%` }} />
          {contestProblems.map((cp) => (
            <col
              key={cp.problemId}
              style={{ width: `${problemColumnWidthPercent}%` }}
            />
          ))}
        </colgroup>
        <thead>
          <tr
            className={`h-15 text-base font-serif font-bold border-b-2 border-gray-400 ${
              isMyTeam
                ? "bg-linear-to-r from-blue-400 to-blue-300 text-white"
                : "bg-white text-gray-700"
            }`}
          >
            <th className="overflow-hidden px-1">Rank</th>
            <th className="overflow-hidden px-1">Team</th>
            <th className="overflow-hidden px-1">Solved</th>
            <th className="overflow-hidden px-1">Penalty</th>
            {contestProblems.map((cp, i) => (
              <th key={cp.problemId} className="overflow-hidden px-0.5">
                <div className="flex min-w-0 items-center justify-center gap-0.5">
                  <Link href={`/contest/${contestId}/problems/${cp.displayId}`}>
                    {String.fromCharCode(65 + i)}
                  </Link>
                  <svg
                    viewBox="0 0 512 512"
                    width="18"
                    height="18"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      fill={cp?.color || "#6b7280"}
                      d="M391 307.27c32.75-46.35 46.59-101.63 39-155.68C416.47 55.59 327.38-11.54 231.38 2S68.24 104.53 81.73 200.53c7.57 53.89 36.12 103.16 80.37 138.74c26.91 21.64 57.59 36.1 86.05 41.33l-8.36 45.23a8 8 0 0 0 9 9.38L279 431c15.9 35.87 41.65 60.48 78.41 75l14.88 5.88l11.77-29.75l-14.88-5.89c-26.35-10.42-44.48-26.16-57-49.92l21.84-3.07a8 8 0 0 0 6.05-11.49l-20.49-41.16c25.98-12.87 51.49-35.18 71.42-63.33m-160.82 15.66c-41.26-16.32-76.3-52.7-91.45-94.94l-5.4-15.06l30.12-10.8l5.4 15.06c14.5 40.44 47.27 65.77 73.1 76l14.88 5.88l-11.77 29.76Z"
                    />
                  </svg>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {teams.map((team) => (
            <tr
              key={team.id}
              className={`h-15 font-[Menlo] ${
                isMyTeam
                  ? "bg-linear-to-r from-blue-100 via-blue-50 to-blue-100 hover:from-blue-200 hover:via-blue-100 hover:to-blue-200"
                  : "even:bg-[#eff5fa] odd:bg-white hover:bg-blue-100"
              }`}
            >
              <td
                className={`text-base font-serif font-bold ${getRankCellColor(
                  team,
                )}`}
              >
                {typeof team.rank === "number" ? team.rank : `${team.rank}`}
              </td>
              <td className="overflow-hidden">
                <div className="flex min-w-0 max-w-full flex-col items-center">
                  <div
                    className="block w-full min-w-0 truncate px-2 font-bold text-blue-900"
                    title={team.displayName || team.username || ""}
                  >
                    {team.category === "1"
                      ? "⭐"
                      : team.category === "2"
                        ? "👧"
                        : ""}
                    {team.isVirtual && (
                      <span className="mr-1 rounded border border-blue-200 bg-blue-50 px-1 text-[10px] font-bold text-blue-700">
                        VP
                      </span>
                    )}
                    {canManageSubmissions && team.contestUserId ? (
                      <Link
                        href={{
                          pathname: `/contest/${contestId}/status`,
                          query: { viewAll: "true", userId: team.contestUserId },
                        }}
                        prefetch={false}
                        className="rounded-sm underline decoration-blue-300 underline-offset-2 hover:text-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                        title={`查看 ${team.displayName || team.username} 的全部提交`}
                      >
                        {team.displayName || team.username}
                      </Link>
                    ) : (
                      team.displayName || team.username
                    )}
                  </div>
                  <div
                    className="block w-full min-w-0 truncate px-2 text-xs text-gray-900"
                    title={team.members || team.username || ""}
                  >
                    {team.members || team.username}
                  </div>
                  <div
                    className="block w-full min-w-0 truncate px-2 text-xs text-gray-900"
                    title={team.school || ""}
                  >
                    {team.school}
                  </div>
                </div>
              </td>
              <td className="font-bold text-base text-gray-800">
                {team.solved}
              </td>
              <td className="text-gray-600 text-sm font-semibold">
                {Math.floor(team.penalty)}
              </td>
              {team.problems.map((prob, idx) => {
                const cellBg = getCellColor(prob);
                const contestProblem = contestProblems[idx];

                // 专门处理蓝色样式 (Pending/Frozen)
                const isFrozenCell =
                  prob && !prob.accepted && prob.frozenTries > 0;
                return (
                  <td
                    key={idx}
                    className={`relative group overflow-hidden border border-white p-0.5 ${
                      isFrozenCell ? "bg-blue-700 text-white" : cellBg
                    }`}
                  >
                    {/* 代码查看按钮 - 固定在右上角(仅限已AC且比赛结束) */}
                    {(prob?.accepted || prob?.upsolved) &&
                      isContestEnded &&
                      !isFrozen &&
                      prob.firstAcceptedSubmissionId && (
                        <Link
                          href={`/contest/${contestId}/status/${prob.firstAcceptedSubmissionId}`}
                          className="absolute top-0 right-0  cursor-pointer rounded-sm p-0.5 z-10"
                          title="View first AC submission"
                        >
                          <svg
                            className="icon"
                            viewBox="0 0 1024 1024"
                            version="1.1"
                            xmlns="http://www.w3.org/2000/svg"
                            width="15"
                            height="15"
                          >
                            <path
                              d="M414.165333 652.501333L273.664 512l140.501333-140.501333a42.666667 42.666667 0 1 0-60.330666-60.330667l-170.666667 170.666667a42.666667 42.666667 0 0 0 0 60.330666l170.666667 170.666667a42.666667 42.666667 0 1 0 60.330666-60.330667zM609.834667 371.498667L750.336 512l-140.501333 140.501333a42.666667 42.666667 0 1 0 60.330666 60.330667l170.666667-170.666667c7.936-7.936 12.501333-18.944 12.501333-30.165333s-4.565333-22.186667-12.501333-30.165333l-170.666667-170.666667a42.666667 42.666667 0 1 0-60.330666 60.330667z"
                              fill="#ffffff"
                            ></path>
                          </svg>
                        </Link>
                      )}

                    {/* 内容区域 */}
                    {prob && (
                      <div className="flex h-full min-w-0 max-w-full flex-col justify-center gap-1 whitespace-nowrap text-[clamp(8px,0.86vw,11px)] font-bold leading-tight tabular-nums">
                        {prob.accepted ? (
                          // 1. 已 AC
                          <>
                            <span className="block truncate px-0.5">
                              {prob.time}
                            </span>
                            {prob.tries > 0 && (
                              <span className="block truncate px-0.5 text-[11px] font-normal opacity-80">
                                (-{prob.tries})
                              </span>
                            )}
                          </>
                        ) : prob.upsolved ? (
                          // === Upsolved 展示逻辑 ===
                          <>
                            {prob.tries > 0 ? (
                              // Upsolved前有WA (- tries)
                              <div className="flex flex-col justify-center items-center">
                                <span className="text-lg font-bold">+</span>
                                <span className="block max-w-full truncate px-0.5">
                                  (-{prob.tries})
                                </span>
                              </div>
                            ) : (
                              // Upsolved前有WA +
                              <span className="text-lg font-bold">+</span>
                            )}
                          </>
                        ) : // <span className="text-lg font-bold">+</span>
                        prob.frozenTries > 0 ? (
                          // 2. 封榜提交 (蓝色)
                          <>
                            {prob.unfrozenTries > 0 ? (
                              // 封榜前有WA (? frozen / - unfrozen)
                              <span className="block truncate px-0.5">
                                (? {prob.frozenTries} / -{prob.unfrozenTries})
                              </span>
                            ) : (
                              // 封榜前无WA (? frozen)
                              <span className="block truncate px-0.5">
                                (? {prob.frozenTries})
                              </span>
                            )}
                          </>
                        ) : prob.tries > 0 ? (
                          // 3. 只有封榜前的 WA (红色)
                          <span className="block truncate px-0.5">
                            (-{prob.tries})
                          </span>
                        ) : null}
                      </div>
                    )}
                    {canManageSubmissions && team.contestUserId && contestProblem && (
                      <Link
                        href={{
                          pathname: `/contest/${contestId}/status`,
                          query: {
                            viewAll: "true",
                            userId: team.contestUserId,
                            problem: contestProblem.displayId,
                          },
                        }}
                        prefetch={false}
                        className="mt-1 inline-flex max-w-full items-center justify-center rounded border border-blue-200 bg-white/95 px-1 py-0.5 text-[10px] font-medium leading-tight text-blue-800 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-800 print:hidden"
                        aria-label={`查看 ${team.displayName || team.username} 的 ${contestProblem.displayId} 题提交`}
                      >
                        查看提交
                      </Link>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
