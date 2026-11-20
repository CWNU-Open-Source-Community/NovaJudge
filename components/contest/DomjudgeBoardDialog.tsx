"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { getBoardRuns } from "@/app/(main)/contest/[contestId]/(board)/rank/domjudge-actions";
import type { StandingsProblem } from "@/lib/contest-team-standings";
import type { BoardTeamDetails } from "@/lib/domjudge-scoreboard";
import { ProblemBadge } from "./DomjudgeScoreBadges";
import DomjudgeSubmissionResult from "./DomjudgeSubmissionResult";
import TeamDetailsDialog, { ScoreboardDialog } from "./TeamDetailsDialog";

export type BoardProblem = StandingsProblem & { title: string };
export type BoardSelection = {
  team: BoardTeamDetails;
  cell?: { problem: BoardProblem; contestId: number; updatedAt: number };
};

export function DomjudgeTeamButton({ team, children }: { team: BoardTeamDetails; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="dj-team-trigger" title={team.name} aria-haspopup="dialog"
      onClick={() => setOpen(true)}>{children}</button>
    {open && <DomjudgeBoardDialog team={team} onClose={() => setOpen(false)} />}
  </>;
}

function CellSubmissions({ contestId, teamId, problemId, updatedAt }: {
  contestId: number; teamId: string; problemId: number; updatedAt: number;
}) {
  const [runs, setRuns] = useState<Awaited<ReturnType<typeof getBoardRuns>>>();
  useEffect(() => {
    let active = true;
    getBoardRuns(contestId, teamId, problemId).then(
      data => { if (active) setRuns(data); },
      () => { if (active) setRuns(null); },
    );
    return () => { active = false; };
  }, [contestId, teamId, problemId, updatedAt]);
  if (runs === undefined) return <p role="status">Loading submissions…</p>;
  if (runs === null) return <p role="status">Submission details are unavailable.</p>;
  if (!runs.length) return <p className="dj-no-submissions">No submissions</p>;
  return <table className="dj-dialog-table">
    <thead><tr><th scope="col">time</th><th scope="col">language</th><th scope="col">result</th></tr></thead>
    <tbody>{runs.map((run, i) => {
      const result = <DomjudgeSubmissionResult result={run.result} />;
      return <tr key={run.detailId ?? `row-${i}`}>
        <td>{run.time}</td><td>{run.language}</td>
        <td>{run.detailId === null ? result : <Link href={`/contest/${contestId}/status/${run.detailId}`}>{result}</Link>}</td>
      </tr>;
    })}</tbody>
  </table>;
}

export default function DomjudgeBoardDialog({ team, cell, onClose }: BoardSelection & { onClose: () => void }) {
  if (!cell) return <TeamDetailsDialog team={team} onClose={onClose} />;
  return <ScoreboardDialog onClose={onClose} title={
    <>Submissions for team {team.name} on problem <ProblemBadge problem={cell.problem} /> {cell.problem.title}</>
  }>
    <CellSubmissions key={`${team.id}/${cell.problem.problemId}`} contestId={cell.contestId} teamId={team.id}
      problemId={cell.problem.problemId} updatedAt={cell.updatedAt} />
  </ScoreboardDialog>;
}
