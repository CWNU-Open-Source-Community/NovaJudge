import Link from "next/link";
import OrganizationLogo from "@/components/OrganizationLogo";
import type { StandingsProblem, TeamRankData } from "@/lib/contest-team-standings";
import { scoreboardCell, type BoardTeamDetails } from "@/lib/domjudge-scoreboard";
import { DomjudgeTeamButton } from "./DomjudgeBoardDialog";
import { CountryFlag, ProblemBadge } from "./DomjudgeScoreBadges";
import MedalBadge from "./MedalBadge";

export default function DomjudgeScoreSummary({ base, team, details, problems, frozen, latestSubmissionByProblem }: {
  base: string; team: TeamRankData; details: BoardTeamDetails; problems: StandingsProblem[]; frozen: boolean;
  latestSubmissionByProblem: ReadonlyMap<number, number>;
}) {
  return <div className="dj-score-scroll" tabIndex={0} role="region" aria-label="Team score">
    <table className="dj-team-score">
      <caption className="sr-only">Your team’s standing</caption>
      <thead><tr>
        <th scope="col">rank</th><th scope="col">team</th><th scope="colgroup" colSpan={2}>score</th>
        {problems.map(problem => <th key={problem.problemId} scope="col">
          <Link href={`${base}/problems/${encodeURIComponent(problem.displayId)}`} aria-label={`Problem ${problem.displayId}`}>
            <ProblemBadge problem={problem} />
          </Link>
        </th>)}
      </tr></thead>
      <tbody><tr>
        <td className="dj-rank-place" title={frozen ? "Rank hidden while the scoreboard is frozen" : undefined}>
          <Link href={`${base}/rank`}><MedalBadge medal={team.medal} />{frozen ? "?" : team.rank}</Link>
        </td>
        <th scope="row" className="dj-rank-team">
          <DomjudgeTeamButton team={details}>
            <OrganizationLogo hash={details.logoHash} />
            <CountryFlag country={details.country} countryName={details.countryName} />
            <span>
              <span className="dj-team-name">
                {details.categoryName && <span className="dj-category" data-category={details.category}>{details.categoryName}</span>}
                <strong>{details.name}</strong>
              </span>
              {details.school && <span className="dj-school">{details.school}</span>}
            </span>
          </DomjudgeTeamButton>
        </th>
        <td className="dj-rank-solved" title="Problems solved">{team.solved}</td>
        <td className="dj-rank-penalty" title="Total penalty in minutes">{team.penalty}</td>
        {problems.map((problem, index) => {
          const cell = scoreboardCell(team.problems[index]);
          const latestSubmission = latestSubmissionByProblem.get(problem.problemId);
          return <td key={problem.problemId} className="dj-rank-problem">
            {cell && <a className={`dj-score-cell dj-score-${cell.state}`}
              href={latestSubmission === undefined ? "#dj-submissions" : `#dj-submission-${latestSubmission}`}
              title={`${problem.displayId} · ${cell.state === "first" ? "first to solve" : cell.state} · ${cell.attempts}`}>
              {cell.minute ?? "\u00a0"}
              <small>{cell.attempts}</small>
            </a>}
          </td>;
        })}
      </tr></tbody>
    </table>
  </div>;
}
