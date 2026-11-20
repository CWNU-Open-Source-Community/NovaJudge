"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { faCircleQuestion, faClock, faThumbsDown, faThumbsUp } from "@fortawesome/free-solid-svg-icons";
import type { BoardTeam, summarizeBoard } from "@/lib/domjudge-scoreboard";
import { scoreboardBadgeStyle } from "@/lib/problem-badge";
import DomjudgeIcon from "./DomjudgeIcon";
import OrganizationLogo from "@/components/OrganizationLogo";
import { CountryFlag, ProblemBadge } from "./DomjudgeScoreBadges";
import MedalBadge from "./MedalBadge";
import DomjudgeBoardDialog, { type BoardProblem, type BoardSelection } from "./DomjudgeBoardDialog";

const legend = { first: "Solved first", correct: "Solved", incorrect: "Tried, incorrect", pending: "Tried, pending", neutral: "Untried" };
const summaryFields = [
  { key: "accepted", title: "number of accepted submissions", icon: faThumbsUp },
  { key: "rejected", title: "number of rejected submissions", icon: faThumbsDown },
  { key: "pending", title: "number of pending submissions", icon: faCircleQuestion },
  { key: "first", title: "first solved", icon: faClock },
] as const;

export default function DomjudgeBoardTable({ contestId, rows, problems, viewerId, updatedAt, medalsEnabled, totals }: {
  contestId: number; rows: BoardTeam[]; problems: BoardProblem[]; viewerId: string; updatedAt: number;
  medalsEnabled: boolean; totals: ReturnType<typeof summarizeBoard>;
}) {
  const [selected, setSelected] = useState<{ teamId: string; problemId?: number } | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const region = viewport.current;
    const table = region?.querySelector("table");
    if (!region || !table) return;
    const observer = new ResizeObserver(() => {
      setOverflow(table.offsetWidth > region.clientWidth);
      for (const label of table.querySelectorAll<HTMLElement>(".dj-board-name, .dj-board-school")) {
        label.toggleAttribute("data-truncated", label.scrollWidth > label.clientWidth);
      }
    });
    observer.observe(region);
    observer.observe(table);
    return () => observer.disconnect();
  }, [rows]);
  const selectedTeam = selected && rows.find(team => team.id === selected.teamId);
  let selection: BoardSelection | null = null;
  if (selectedTeam && selected) {
    const index = problems.findIndex(problem => problem.problemId === selected.problemId);
    if (selected.problemId === undefined) selection = { team: selectedTeam };
    else if (selectedTeam.canViewRuns && selectedTeam.cells[index]) {
      selection = { team: selectedTeam, cell: { problem: problems[index], contestId, updatedAt } };
    }
  }
  if (selected && !selection) setSelected(null);

  const hasFlags = rows.some(team => team.country);
  const hasLogos = rows.some(team => team.logoHash);
  const placeCols = medalsEnabled ? 2 : 1;
  const teamCols = 1 + Number(hasLogos) + Number(hasFlags);
  const problemStyles = problems.map(problem => scoreboardBadgeStyle(problem.color));
  return <>
    <div className="dj-board-viewport" ref={viewport} data-overflow={overflow} tabIndex={overflow ? 0 : undefined} role="region" aria-label="Scoreboard table">
      <table className="dj-board-table mobile-scoreboard">
        <caption className="sr-only">Contest standings</caption>
        <thead><tr><th scope="colgroup" colSpan={placeCols}>rank</th>
          <th scope="colgroup" colSpan={teamCols} className="dj-heading-team">team</th>
          <th scope="colgroup" colSpan={2} title="# solved / penalty time">score</th>
          {problems.map(problem => <th scope="col" key={problem.problemId} className="dj-heading-problem" title={problem.title}>
            <Link href={`/contest/${contestId}/problems/${encodeURIComponent(problem.displayId)}`} aria-label={`Problem ${problem.displayId}: ${problem.title}`}>
              <ProblemBadge problem={problem} />
            </Link>
          </th>)}
        </tr></thead>
        <tbody>
          {rows.map((team, rowIndex) => <tr key={team.id} aria-current={team.id === viewerId ? "true" : undefined}>
            {medalsEnabled && <td className="dj-board-medal"><MedalBadge medal={team.medal} /></td>}
            <td className="dj-board-place">{team.rank === "*" || rows[rowIndex - 1]?.rank !== team.rank ? team.rank : <span className="sr-only">{team.rank} (tied)</span>}</td>
            {hasLogos && <td className="dj-board-logo"><OrganizationLogo hash={team.logoHash} /></td>}
            {hasFlags && <td className="dj-board-affiliation"><CountryFlag country={team.country} countryName={team.countryName} /></td>}
            <th scope="row" className="dj-board-team">
              <button type="button" title={team.name} aria-haspopup="dialog" onClick={() => setSelected({ teamId: team.id })}>
                <span className="dj-board-name">{team.category && team.category !== "0" && <span className="dj-category" data-category={team.category}>{team.categoryName}</span>}{team.name}</span>
                {team.school && <span className="dj-board-school">{team.school}</span>}
              </button>
            </th>
            <td className="dj-board-solved" title="Problems solved">{team.solved}</td>
            <td className="dj-board-penalty" title="Total penalty in minutes">{team.penalty}</td>
            {problems.map((problem, index) => {
              const cell = team.cells[index];
              const score = cell && <span className={`dj-score-cell dj-score-${cell.state}`}>
                {cell.minute ?? "\u00a0"}<small>{cell.attempts}</small>
              </span>;
              const label = cell ? `${team.name}, problem ${problem.displayId}, ${legend[cell.state]}, ${cell.attempts}` +
                (cell.minute === null ? "" : `, ${cell.minute} min`) : undefined;
              return <td key={problem.problemId} className="dj-board-problem" data-problem={problem.displayId}
                data-state={cell?.state} style={problemStyles[index]} aria-label={team.canViewRuns ? undefined : label}>
                {cell && team.canViewRuns ? <button type="button" title={`${legend[cell.state]} · ${cell.attempts}`}
                  aria-label={label} onClick={() => setSelected({ teamId: team.id, problemId: problem.problemId })}>
                  {score}
                </button> : score}
              </td>;
            })}
          </tr>)}
          {rows.length > 0 ? <tr className="dj-board-summary">
            <th scope="row" colSpan={placeCols + teamCols}>Summary</th>
            <td className="dj-board-solved" title="total solved">{rows.reduce((sum, team) => sum + team.solved, 0)}</td><td />
            {totals.map((total, i) => <td key={problems[i].problemId} className="dj-problem-total">{summaryFields.map(({ key, title, icon }) =>
              <span key={key} title={title}><DomjudgeIcon icon={icon} /><span className={`dj-stat-${key}`}>
                <span className="sr-only">{title}: </span>{key === "first" ? (total.first === null ? "n/a" : `${total.first}min`) : total[key]}
              </span></span>
            )}</td>)}
          </tr> : <tr><td className="dj-no-teams" colSpan={placeCols + teamCols + 2 + problems.length}>No teams to display.</td></tr>}
        </tbody>
      </table>
    </div>
    <table className="dj-cell-legend"><thead><tr><th>Cell colours</th></tr></thead>
      <tbody>{Object.entries(legend).map(([state, label]) => <tr key={state}><td className={`dj-score-${state}`}>{label}</td></tr>)}</tbody>
    </table>
    {selection && <DomjudgeBoardDialog {...selection} onClose={() => setSelected(null)} />}
  </>;
}
