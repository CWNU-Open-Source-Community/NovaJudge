"use client";

import Link from "next/link";
import { useState } from "react";
import OrganizationLogo from "@/components/OrganizationLogo";
import MedalBadge from "@/components/contest/MedalBadge";
import TeamDetailsDialog from "@/components/contest/TeamDetailsDialog";
import { CountryFlag } from "@/components/contest/DomjudgeScoreBadges";
import { useLanguage } from "@/context/LanguageContext";
import { formatMessage, getLocale, getVerdictLabel, type Dictionary } from "@/lib/dictionaries";
import type { RankProblemStats } from "@/lib/rank-problem-stats";

import type { TeamRankData } from "@/lib/contest-team-standings";
import type { BoardTeamDetails } from "@/lib/domjudge-scoreboard";
import { attemptsLabel, problemColorStyle, scoreboardBadgeStyle } from "@/lib/problem-badge";

interface ContestProblem {
  problemId: number;
  displayId: string;
  color: string | null;
}

export type RankTableTeam = BoardTeamDetails & Pick<TeamRankData,
  "rank" | "medal" | "contestUserId" | "isVirtual" | "solved" | "penalty" | "problems">;

interface RankTableProps {
  contestId: string;
  teams: RankTableTeam[];
  isMyTeam: boolean;
  isContestEnded: boolean;
  canManageSubmissions: boolean;
  contestProblems: ContestProblem[];
  isFrozen: boolean;
  tableLabel?: string;
  problemStats?: RankProblemStats[];
  statsBeforeFreeze?: boolean;
}

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
      state: problem.firstBlood ? "first" : "correct",
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
      state: "upsolved",
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
      state: "pending",
      value: null,
      detail: `${problem.unfrozenTries} + ${problem.frozenTries} ${suffix}`,
      label: [status, during, before].filter(Boolean).join(" · "),
      style: "rank-frozen bg-blue-700 text-white",
    };
  }

  if (problem && problem.tries > 0) {
    const detail = attemptsLabel(problem.tries);
    const pending = !!problem.pendingTries;
    return {
      state: pending ? "pending" : "incorrect",
      value: null,
      detail,
      label: `${pending ? getVerdictLabel("PENDING") : rank.unsolved} · ${detail}`,
      style: pending ? "bg-blue-700 text-white" : "rank-unsolved bg-[#d32f2f] text-white",
    };
  }

  return { state: undefined, value: null, detail: null, label: rank.noSubmission, style: "" };
}

export default function RankTable({
  contestId,
  teams,
  isMyTeam,
  isContestEnded,
  canManageSubmissions,
  contestProblems,
  isFrozen,
  tableLabel,
  problemStats,
  statsBeforeFreeze,
}: RankTableProps) {
  const { dict: { rank, common, virtualParticipation }, lang } = useLanguage();
  const locale = getLocale(lang);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedTeam = selectedId && teams.find(team => team.id === selectedId);
  const statusPath = `/contest/${contestId}/status`;
  const label = tableLabel ?? (isMyTeam ? rank.yourResult : rank.title);
  const badgeStyles = contestProblems.map(problem => scoreboardBadgeStyle(problem.color));
  const statsTitle = statsBeforeFreeze ? rank.statsBeforeFreeze : rank.stats;
  const statsRows = [
    { key: "submitted", label: rank.submitted },
    { key: "attempted", label: rank.attempted },
    { key: "accepted", label: rank.acceptedTeams },
  ] as const;

  return (<>
    <div
      className="rank-table-viewport @container w-full overflow-x-auto overscroll-x-contain focus-visible:outline-2 focus-visible:outline-blue-600"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <table className="nova-rank-table mobile-scoreboard table-fixed border-separate border-spacing-0 text-center font-sans text-sm text-slate-800">
        <caption className="sr-only">{label}</caption>
        <colgroup>
          <col className="rank-medal-col" />
          <col className="rank-place-col" />
        </colgroup>
        <colgroup>
          <col className="rank-team-col" />
        </colgroup>
        <colgroup>
          <col span={2} className="rank-score-col" />
        </colgroup>
        {contestProblems.length > 0 && (
          <colgroup>
            {contestProblems.map((problem) => <col key={problem.problemId} />)}
          </colgroup>
        )}
        <thead className="text-[11px] font-semibold uppercase tracking-wide">
          <tr className={isMyTeam ? "bg-blue-50" : "bg-white"}>
            <th scope="colgroup" colSpan={2} className={headerCell}>{rank.place}</th>
            <th
              scope="col"
              className={`${headerCell} dj-heading-team sticky left-0 z-20 bg-inherit`}
            >
              {common.team}
            </th>
            <th scope="colgroup" colSpan={2} className={`${headerCell} rank-score-heading text-center`}>{rank.score}</th>
            {contestProblems.map((problem) => (
              <th scope="col" key={problem.problemId} className={`${headerCell} dj-heading-problem normal-case tracking-normal`}>
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
              <td colSpan={5 + contestProblems.length} className="bg-white px-4 py-8 text-left text-slate-500">
                {rank.noTeams}
              </td>
            </tr>
          )}
          {teams.map((team) => {
            const name = team.name;
            const teamId = canManageSubmissions ? team.contestUserId : undefined;

            return (
              <tr
                key={team.id}
                aria-current={isMyTeam ? "true" : undefined}
                className={isMyTeam ? "bg-blue-50 hover:bg-blue-100" : "bg-white hover:bg-slate-50"}
              >
                <td className={`${rowDivider} dj-board-medal text-right align-middle`}>
                  <MedalBadge medal={team.medal} labels={rank} />
                </td>
                <td className={`${bodyCell} dj-board-place px-1 text-right align-middle tabular-nums`}>
                  {team.rank}
                </td>
                <th
                  scope="row"
                  className={`${bodyCell} dj-board-team sticky left-0 z-20 min-w-0 bg-inherit p-0 text-right align-middle font-normal`}
                >
                  <button type="button" aria-haspopup="dialog" title={name} onClick={() => setSelectedId(team.id)}
                    className="flex min-h-13 w-full cursor-pointer items-center gap-2 px-2 py-1 text-right after:absolute after:inset-0 hover:text-blue-700 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600">
                    <OrganizationLogo hash={team.logoHash} />
                    {team.country && <span className="shrink-0 md:hidden">
                      <CountryFlag country={team.country} countryName={team.countryName} />
                    </span>}
                    <span className="grid min-w-0 flex-1 gap-1">
                      <span className="flex min-w-0 items-center justify-end gap-1 font-semibold leading-tight">
                        {(team.category === "1" || team.category === "2") && <>
                          <span className="hidden md:inline" title={team.category === "1" ? rank.unofficialTeam : rank.womenTeam}>
                            {team.category === "1" ? "⭐" : "👧"}
                          </span>
                          <span className="dj-category shrink-0 md:hidden" data-category={team.category}>
                            {team.category === "1" ? rank.unofficialTeam : rank.womenTeam}
                          </span>
                        </>}
                        {team.isVirtual && (
                          <span className="rounded border border-blue-200 bg-blue-50 px-1 text-[10px] text-blue-700" title={virtualParticipation.title}>
                            VP
                          </span>
                        )}
                        <span className="min-w-0 truncate">{name}</span>
                      </span>
                      {team.school && <span className="truncate text-xs leading-tight text-slate-600">{team.school}</span>}
                    </span>
                  </button>
                </th>
                <td className={`${rowDivider} dj-board-solved font-bold tabular-nums`}>
                  <span className="sr-only">{rank.solved} </span>{team.solved}
                </td>
                <td className={`${bodyCell} dj-board-penalty tabular-nums`}>
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
                      className={`${rowDivider} dj-board-problem relative p-px align-middle`}
                      data-problem={contestProblem.displayId} data-state={result.state} style={badgeStyles[index]}
                      aria-label={`${contestProblem.displayId} · ${result.label}`}
                      title={result.label}
                    >
                      {teamId && (
                        <Link
                          href={{ pathname: statusPath, query: { viewAll: "true", userId: teamId, problem: contestProblem.displayId } }}
                          prefetch={false}
                          className="rank-problem-submissions absolute inset-0 hover:bg-black/5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-current"
                        >
                          <span className="sr-only">
                            {formatMessage(rank.problemSubmissions, { team: name, problem: contestProblem.displayId })} · {result.label}
                          </span>
                        </Link>
                      )}
                      <div className={`${cellLines} justify-items-center px-0.5 ${result.style}`}>
                        {firstAcceptedSubmissionId ? (
                          <Link
                            href={`/contest/${contestId}/status/${firstAcceptedSubmissionId}`}
                            className={`rank-first-accepted ${resultValue} relative z-10 rounded-sm underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current`}
                            aria-label={`${contestProblem.displayId} · ${rank.firstAccepted} · ${result.label}`}
                            title={rank.firstAccepted}
                          >
                            <span>{result.value}</span>
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
              <th scope="row" colSpan={5} className={`${summaryCell} border-t border-t-slate-600 pr-3 text-right`}>
                {statsTitle}
              </th>
              {contestProblems.map((problem) => (
                <td key={problem.problemId} className={`${summaryCell} truncate border-t border-t-slate-600`} title={problem.displayId}>
                  {problem.displayId}
                </td>
              ))}
            </tr>
            {statsRows.map(({ key, label }) => (
              <tr key={key}>
                <th scope="row" colSpan={5} className={`${summaryCell} pr-3 text-right font-medium`}>{label}</th>
                {problemStats.map((problem) => (
                  <td key={problem.problemId} className={summaryCell}>{problem[key].toLocaleString(locale)}</td>
                ))}
              </tr>
            ))}
          </tfoot>
        )}
      </table>
    </div>
    {problemStats && problemStats.length > 0 && (
      <details className="mt-1 text-sm md:hidden print:hidden">
        <summary className="cursor-pointer py-1">{statsTitle}</summary>
        <table className="w-full text-center text-xs tabular-nums">
          <caption className="sr-only">{statsTitle}</caption>
          <thead><tr><th scope="col">{common.problem}</th>{statsRows.map(stat =>
            <th key={stat.key} scope="col">{stat.label}</th>)}</tr></thead>
          <tbody>{problemStats.map((problem, index) => <tr key={problem.problemId} className="border-t border-slate-200">
            <th scope="row" className="py-1">{contestProblems[index].displayId}</th>
            {statsRows.map(stat => <td key={stat.key}>{problem[stat.key].toLocaleString(locale)}</td>)}
          </tr>)}</tbody>
        </table>
      </details>
    )}
    {selectedTeam && <TeamDetailsDialog team={selectedTeam} language={lang} onClose={() => setSelectedId(null)}
      action={canManageSubmissions && selectedTeam.contestUserId && (
        <Link href={{ pathname: statusPath, query: { viewAll: "true", userId: selectedTeam.contestUserId } }}
          prefetch={false} className="text-blue-700 underline underline-offset-2">
          {formatMessage(rank.teamSubmissions, { team: selectedTeam.name })}
        </Link>
      )} />}
  </>);
}
