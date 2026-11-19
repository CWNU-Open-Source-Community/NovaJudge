import "flag-icons/css/flag-icons.min.css";
import { faMedal } from "@fortawesome/free-solid-svg-icons";
import type { StandingsProblem, TeamRankData } from "@/lib/contest-team-standings";
import { problemColorStyle } from "@/lib/problem-badge";
import DomjudgeIcon from "./DomjudgeIcon";

export function MedalBadge({ medal }: { medal: TeamRankData["medal"] }) {
  if (!medal) return null;
  return <span className={`dj-medal dj-medal-${medal.toLowerCase()}`} title={`${medal} medal`}>
    <DomjudgeIcon icon={faMedal} /><span className="sr-only">{medal} medal</span>
  </span>;
}

export function ProblemBadge({ problem }: { problem: Pick<StandingsProblem, "displayId" | "color"> }) {
  return <span className="dj-badge" style={problemColorStyle(problem.color ?? "#ffffff", "domjudge")}>{problem.displayId}</span>;
}

export function CountryFlag({ country, countryName }: { country: string; countryName: string }) {
  if (!country) return null;
  return <span className={`dj-country fi fi-${country.toLowerCase()}`} role="img" aria-label={countryName} title={countryName} />;
}
