"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { getBoardRuns } from "@/app/(main)/contest/[contestId]/(board)/rank/domjudge-actions";
import type { StandingsProblem } from "@/lib/contest-team-standings";
import type { BoardTeamDetails } from "@/lib/domjudge-scoreboard";
import OrganizationLogo from "@/components/OrganizationLogo";
import { CountryFlag, ProblemBadge } from "./DomjudgeScoreBadges";
import DomjudgeSubmissionResult from "./DomjudgeSubmissionResult";

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
  return <Dialog open onClose={onClose} className="dj-dialog" lang="en">
    <div className="dj-backdrop" aria-hidden="true" />
    <div className="dj-dialog-position"><DialogPanel className="dj-dialog-panel dj-board-dialog">
      <header><DialogTitle>{cell ? <>Submissions for team {team.name} on problem <ProblemBadge problem={cell.problem} /> {cell.problem.title}</> : team.name}</DialogTitle>
        <button type="button" aria-label="Close" onClick={onClose}><XMarkIcon className="size-5" /></button>
      </header>
      <div className="dj-board-dialog-body">
        {cell ? <CellSubmissions key={`${team.id}/${cell.problem.problemId}`} contestId={cell.contestId} teamId={team.id}
          problemId={cell.problem.problemId} updatedAt={cell.updatedAt} /> :
          <table className="dj-dialog-table"><tbody>
            <tr><th scope="row">Name</th><td>{team.name}</td></tr>
            <tr><th scope="row">Categories</th><td>{team.categoryName || "–"}</td></tr>
            {team.school && <tr><th scope="row">Affiliation</th><td><span className="dj-dialog-affiliation">
              <OrganizationLogo hash={team.logoHash} /><span>{team.school}</span>
            </span></td></tr>}
            {team.country && <tr><th scope="row">Country</th><td><CountryFlag country={team.country} countryName={team.countryName} /> {team.countryName}</td></tr>}
            {team.members && <tr><th scope="row">Members</th><td>{team.members}</td></tr>}
            {team.coach && <tr><th scope="row">Coach</th><td>{team.coach}</td></tr>}
          </tbody></table>}
      </div>
      <footer><button className="dj-secondary" onClick={onClose}>Close</button></footer>
    </DialogPanel></div>
  </Dialog>;
}
