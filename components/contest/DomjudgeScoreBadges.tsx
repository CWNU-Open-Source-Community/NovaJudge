import "flag-icons/css/flag-icons.min.css";
import type { StandingsProblem } from "@/lib/contest-team-standings";
import { problemColorStyle } from "@/lib/problem-badge";

export function ProblemBadge({ problem }: { problem: Pick<StandingsProblem, "displayId" | "color"> }) {
  return <span className="dj-badge" style={problemColorStyle(problem.color ?? "#ffffff", "domjudge")}>{problem.displayId}</span>;
}

export function CountryFlag({ country, countryName }: { country: string; countryName: string }) {
  if (!country) return null;
  return <span className={`dj-country fi fi-${country.toLowerCase()}`} role="img" aria-label={countryName} title={countryName} />;
}
