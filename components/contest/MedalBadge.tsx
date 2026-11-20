import { faMedal } from "@fortawesome/free-solid-svg-icons";
import type { TeamRankData } from "@/lib/contest-team-standings";
import type { Dictionary } from "@/lib/dictionaries";
import DomjudgeIcon from "./DomjudgeIcon";

const labelKeys = { Gold: "goldMedal", Silver: "silverMedal", Bronze: "bronzeMedal" } as const;

export default function MedalBadge({ medal, labels }: {
  medal: TeamRankData["medal"];
  labels?: Pick<Dictionary["rank"], "goldMedal" | "silverMedal" | "bronzeMedal">;
}) {
  if (!medal) return null;
  const description = labels?.[labelKeys[medal]] ?? `${medal} medal`;
  return <span className={`dj-medal dj-medal-${medal.toLowerCase()}`} title={description}>
    <DomjudgeIcon icon={faMedal} /><span className="sr-only">{description}</span>
  </span>;
}
