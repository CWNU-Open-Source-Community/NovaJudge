"use client";

import Link from "next/link";
import { TrophyIcon } from "@heroicons/react/24/solid";
import OrganizationLogo from "@/components/OrganizationLogo";
import { useLanguage } from "@/context/LanguageContext";
import { formatMessage, getLocale, getVerdictLabel, type Dictionary } from "@/lib/dictionaries";
import type { RankProblemStats } from "@/lib/rank-problem-stats";

import type { TeamRankData } from "@/lib/contest-team-standings";
import { attemptsLabel, problemColorStyle } from "@/lib/problem-badge";

interface ContestProblem {
  problemId: number;
  displayId: string;
  color: string | null;
}

interface RankTableProps {
  contestId: string;
  teams: TeamRankData[];
  isMyTeam: boolean;
  isContestEnded: boolean;
  canManageSubmissions: boolean;
  contestProblems: ContestProblem[];
  isFrozen: boolean;
  teamColumnWidth: number;
  tableLabel?: string;
  problemStats?: RankProblemStats[];
  statsBeforeFreeze?: boolean;
}

const medalClasses = {
  Gold: "text-yellow-500",
  Silver: "text-slate-400",
  Bronze: "text-amber-700",
};

const headerCell = "border-r border-r-slate-300 border-b-2 border-b-slate-800 px-1 py-2 last:border-r-0";
const rowDivider = "border-b border-b-slate-400";
const bodyCell = `${rowDivider} border-r border-r-slate-300`;
const cellLines = "rank-cell-lines grid min-h-13 auto-rows-fr grid-cols-1 items-center gap-y-1 py-1";
const resultValue = "text-base font-medium leading-none tabular-nums";
const summaryCell = "border-b border-r border-slate-200 px-1 py-1 last:border-r-0";

function problemResult(problem: TeamRankData["problems"][number], rank: Dictionary["rank"]) {
  if (problem?.accepted) {
    const detail = attemptsLabel(problem.tries + 1);
    const elapsed = formatMessage(rank.acceptedAt, { minutes: problem.time });
    const status = problem.firstBlood ? rank.firstSolve : getVerdictLabel("ACCEPTED");
    return {
      value: problem.time,
      detail,
      label: `${status} · ${elapsed} · ${detail}`,
      style: problem.firstBlood
        ? "bg-[var(--rank-first-solve)] text-black"
        : "bg-[var(--rank-accepted)] text-black",
    };
  }

  if (problem?.upsolved) {
    const detail = problem.tries > 0 ? attemptsLabel(problem.tries) : rank.upsolved;
    return {
      value: "+",
      detail,
      label: problem.tries > 0 ? `${rank.upsolved} · ${detail}` : rank.upsolved,
      style: problem.frozenTries > 0 ? "bg-blue-700 text-white" : "bg-blue-400 text-slate-950",
    };
  }

  if (problem && problem.frozenTries > 0) {
    const status = getVerdictLabel("FROZEN");
    const before = problem.unfrozenTries > 0 ? attemptsLabel(problem.unfrozenTries) : null;
    const during = formatMessage(rank.frozenAttempts, { count: problem.frozenTries });
    const suffix = problem.unfrozenTries + problem.frozenTries === 1 ? "try" : "tries";
    return {
      value: null,
      detail: `${problem.unfrozenTries} + ${problem.frozenTries} ${suffix}`,
      label: [status, during, before].filter(Boolean).join(" · "),
      style: "rank-frozen bg-blue-700 text-white",
    };
  }

  if (problem && problem.tries > 0) {
    const detail = attemptsLabel(problem.tries);
    return {
      value: null,
      detail,
      label: `${rank.unsolved} · ${detail}`,
      style: "rank-unsolved bg-[#d32f2f] text-white",
    };
  }

  return { value: null, detail: null, label: rank.noSubmission, style: "" };
}

export default function RankTable({
  contestId,
  teams,
  isMyTeam,
  isContestEnded,
  canManageSubmissions,
  contestProblems,
  isFrozen,
  teamColumnWidth,
  tableLabel,
  problemStats,
  statsBeforeFreeze,
}: RankTableProps) {
  const { dict: { rank, common, virtualParticipation }, lang } = useLanguage();
  const locale = getLocale(lang);
  const rankColumnWidth = 64;
  const minimumTeamWidth = 112;
  const solvedColumnWidth = 40;
  const penaltyColumnWidth = 52;
  const problemColumnWidth = 44;
  const fixedColumnWidth = rankColumnWidth + solvedColumnWidth + penaltyColumnWidth +
    contestProblems.length * problemColumnWidth;
  const teamWidth = `clamp(${minimumTeamWidth}px, min(34cqw, calc(100cqw - ${fixedColumnWidth}px)), ${teamColumnWidth}px)`;
  const medalLabels = { Gold: rank.goldMedal, Silver: rank.silverMedal, Bronze: rank.bronzeMedal };
  const label = tableLabel ?? (isMyTeam ? rank.yourResult : rank.title);
  const statsRows = [
    { key: "submitted", label: rank.submitted },
    { key: "attempted", label: rank.attempted },
    { key: "accepted", label: rank.acceptedTeams },
  ] as const;

  return (
    <div
      className="@container w-full overflow-x-auto overscroll-x-contain focus-visible:outline-2 focus-visible:outline-blue-600"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <table
        className="w-full table-fixed border-separate border-spacing-0 text-center font-sans text-sm text-slate-800"
        style={{ minWidth: fixedColumnWidth + minimumTeamWidth }}
      >
        <caption className="sr-only">{label}</caption>
        <colgroup>
          <col style={{ width: rankColumnWidth }} />
        </colgroup>
        <colgroup>
          <col style={{ width: teamWidth }} />
        </colgroup>
        <colgroup>
          <col style={{ width: solvedColumnWidth }} />
          <col style={{ width: penaltyColumnWidth }} />
        </colgroup>
        {contestProblems.length > 0 && (
          <colgroup>
            {contestProblems.map((problem) => <col key={problem.problemId} />)}
          </colgroup>
        )}
        <thead className="text-[11px] font-semibold uppercase tracking-wide">
          <tr className={isMyTeam ? "bg-blue-50" : "bg-white"}>
            <th scope="col" className={headerCell}>{rank.place}</th>
            <th
              scope="col"
              className={`${headerCell} sticky left-0 z-20 bg-inherit`}
            >
              {common.team}
            </th>
            <th scope="colgroup" colSpan={2} className={headerCell}>{rank.score}</th>
            {contestProblems.map((problem) => (
              <th scope="col" key={problem.problemId} className={`${headerCell} normal-case tracking-normal`}>
                <Link
                  href={`/contest/${contestId}/problems/${encodeURIComponent(problem.displayId)}`}
                  className="inline-flex h-7 min-w-7 max-w-full items-center justify-center rounded-md bg-slate-200 px-1 text-sm font-bold text-slate-900 ring-1 ring-black/10 ring-inset hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                  style={problemColorStyle(problem.color)}
                  title={problem.displayId}
                >
                  <span className="truncate">{problem.displayId}</span>
                </Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {teams.length === 0 && (
            <tr>
              <td colSpan={4 + contestProblems.length} className="bg-white px-4 py-8 text-left text-slate-500">
                {rank.noTeams}
              </td>
            </tr>
          )}
          {teams.map((team) => {
            const name = team.displayName || team.username;
            const members = team.members || (name !== team.username ? team.username : null);
            const teamDetails = [team.school, members].filter(Boolean).join(" · ");
            const medal = team.category !== "1" && team.rank !== "*" ? team.medal : null;
            const teamId = canManageSubmissions ? team.contestUserId : undefined;
            const teamStatusHref = {
              pathname: `/contest/${contestId}/status`,
              query: { viewAll: "true", userId: teamId },
            };

            return (
              <tr
                key={team.id}
                className={isMyTeam ? "bg-blue-50 hover:bg-blue-100" : "bg-white hover:bg-slate-50"}
              >
                <td className={`${bodyCell} align-middle`}>
                  <div className="grid grid-cols-[18px_minmax(0,1fr)] items-center gap-1 pr-2 pl-1 tabular-nums">
                    {medal && (
                      <span className="col-start-1 inline-flex justify-center" title={medalLabels[medal]}>
                        <TrophyIcon aria-hidden="true" className={`size-4 ${medalClasses[medal]}`} />
                        <span className="sr-only">{medalLabels[medal]}</span>
                      </span>
                    )}
                    <span className="col-start-2 truncate text-right" title={String(team.rank)}>
                      {team.rank}
                    </span>
                  </div>
                </td>
                <th
                  scope="row"
                  className={`${bodyCell} sticky left-0 z-20 min-w-0 bg-inherit px-2 text-right align-middle font-normal`}
                >
                  <div className="flex items-center gap-2">
                    <OrganizationLogo hash={team.logoHash} />
                    <div className={`${cellLines} min-w-0 flex-1`}>
                      <div className="flex min-w-0 items-center justify-end gap-1 font-semibold leading-tight text-slate-900">
                        {team.category === "1" && <span title={rank.unofficialTeam}>⭐</span>}
                        {team.category === "2" && <span title={rank.womenTeam}>👧</span>}
                        {team.isVirtual && (
                          <span className="rounded border border-blue-200 bg-blue-50 px-1 text-[10px] text-blue-700" title={virtualParticipation.title}>
                            VP
                          </span>
                        )}
                        {teamId ? (
                          <Link
                            href={teamStatusHref}
                            prefetch={false}
                            className="min-w-0 truncate rounded-sm underline decoration-blue-300 underline-offset-2 hover:text-blue-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600"
                            title={formatMessage(rank.teamSubmissions, { team: name })}
                          >
                            {name}
                          </Link>
                        ) : (
                          <span className="min-w-0 truncate" title={name}>{name}</span>
                        )}
                      </div>
                      {teamDetails && (
                        <div className="truncate text-xs leading-tight text-slate-600" title={teamDetails}>{teamDetails}</div>
                      )}
                    </div>
                  </div>
                </th>
                <td className={`${rowDivider} font-bold tabular-nums`}>
                  <span className="sr-only">{rank.solved} </span>{team.solved}
                </td>
                <td className={`${bodyCell} tabular-nums`}>
                  <span className="sr-only">{rank.penalty} </span>{Math.floor(team.penalty)}
                </td>
                {contestProblems.map((contestProblem, index) => {
                  const problem = team.problems[index] ?? null;
                  const result = problemResult(problem, rank);
                  const firstAcceptedSubmissionId =
                    (problem?.accepted || problem?.upsolved) && isContestEnded && !isFrozen
                      ? problem.firstAcceptedSubmissionId
                      : undefined;

                  return (
                    <td
                      key={contestProblem.problemId}
                      className={`${rowDivider} relative p-px align-middle`}
                      title={result.label}
                    >
                      <div className={`${cellLines} justify-items-center px-0.5 ${result.style}`}>
                        {teamId && (
                          <Link
                            href={{
                              ...teamStatusHref,
                              query: { ...teamStatusHref.query, problem: contestProblem.displayId },
                            }}
                            prefetch={false}
                            className="absolute inset-0 hover:bg-black/5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-current"
                          >
                            <span className="sr-only">
                              {formatMessage(rank.problemSubmissions, { team: name, problem: contestProblem.displayId })} · {result.label}
                            </span>
                          </Link>
                        )}
                        {firstAcceptedSubmissionId ? (
                          <Link
                            href={`/contest/${contestId}/status/${firstAcceptedSubmissionId}`}
                            className={`${resultValue} relative z-10 rounded-sm underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current`}
                            aria-label={`${rank.firstAccepted} · ${result.label}`}
                            title={rank.firstAccepted}
                          >
                            {result.value}
                          </Link>
                        ) : (
                          <>
                            {!teamId && <span className="sr-only">{result.label}</span>}
                            {result.value !== null && (
                              <span aria-hidden="true" className={resultValue}>{result.value}</span>
                            )}
                          </>
                        )}
                        {result.detail && (
                          <span aria-hidden="true" className="max-w-full text-[10px] leading-tight wrap-break-word tabular-nums">
                            {result.detail}
                          </span>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        {problemStats && problemStats.length > 0 && (
          <tfoot className="bg-slate-50 text-xs text-slate-700 tabular-nums">
            <tr className="bg-[#eaf2fb] font-semibold text-slate-800">
              <th scope="row" colSpan={4} className={`${summaryCell} border-t border-t-slate-600 pr-3 text-right`}>
                {statsBeforeFreeze ? rank.statsBeforeFreeze : rank.stats}
              </th>
              {contestProblems.map((problem) => (
                <td key={problem.problemId} className={`${summaryCell} truncate border-t border-t-slate-600`} title={problem.displayId}>
                  {problem.displayId}
                </td>
              ))}
            </tr>
            {statsRows.map(({ key, label }) => (
              <tr key={key}>
                <th scope="row" colSpan={4} className={`${summaryCell} pr-3 text-right font-medium`}>{label}</th>
                {problemStats.map((problem) => (
                  <td key={problem.problemId} className={summaryCell}>{problem[key].toLocaleString(locale)}</td>
                ))}
              </tr>
            ))}
          </tfoot>
        )}
      </table>
    </div>
  );
}
