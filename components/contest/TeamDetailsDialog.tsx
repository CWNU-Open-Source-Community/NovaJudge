"use client";

import type { ReactNode } from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import OrganizationLogo from "@/components/OrganizationLogo";
import { en, zh, type Language } from "@/lib/dictionaries";
import type { BoardTeamDetails } from "@/lib/domjudge-scoreboard";
import { CountryFlag } from "./DomjudgeScoreBadges";

export function ScoreboardDialog({ title, children, onClose, language = "en", action }: {
  title: ReactNode; children: ReactNode; onClose: () => void; language?: Language; action?: ReactNode;
}) {
  const close = (language === "zh" ? zh : en).common.close;
  return <Dialog open onClose={onClose} className="dj-dialog" lang={language}>
    <div className="dj-backdrop" aria-hidden="true" />
    <div className="dj-dialog-position"><DialogPanel className="dj-dialog-panel dj-board-dialog">
      <header>
        <DialogTitle className="min-w-0 wrap-anywhere">{title}</DialogTitle>
        <button type="button" aria-label={close} onClick={onClose}><XMarkIcon className="size-5" /></button>
      </header>
      <div className="dj-board-dialog-body">{children}</div>
      <footer className="flex flex-wrap items-center justify-end gap-3">
        {action}
        <button type="button" className="dj-secondary" onClick={onClose}>{close}</button>
      </footer>
    </DialogPanel></div>
  </Dialog>;
}

export default function TeamDetailsDialog({ team, onClose, language = "en", action }: {
  team: BoardTeamDetails; onClose: () => void; language?: Language; action?: ReactNode;
}) {
  const dict = language === "zh" ? zh : en;
  const labels = dict.rank.teamDetails;
  const categories: Record<string, string> = {
    "0": dict.rank.officialTeam, "1": dict.rank.unofficialTeam, "2": dict.rank.womenTeam,
  };
  const category = team.category === "VP" ? dict.virtualParticipation.title
    : language === "zh" ? categories[team.category] ?? team.categoryName : team.categoryName;
  const country = team.country && language === "zh"
    ? new Intl.DisplayNames(["zh-CN"], { type: "region" }).of(team.country) ?? team.countryName : team.countryName;

  return <ScoreboardDialog title={team.name} language={language} onClose={onClose} action={action}>
    <table className="dj-dialog-table wrap-anywhere"><tbody>
      <tr><th scope="row">{labels.name}</th><td>{team.name}</td></tr>
      <tr><th scope="row">{labels.categories}</th><td>{category || "–"}</td></tr>
      {team.school && <tr><th scope="row">{labels.affiliation}</th><td><span className="dj-dialog-affiliation">
        <OrganizationLogo hash={team.logoHash} /><span>{team.school}</span>
      </span></td></tr>}
      {team.country && <tr><th scope="row">{labels.country}</th><td><CountryFlag country={team.country} countryName={country} /> {country}</td></tr>}
      {team.members && <tr><th scope="row">{labels.members}</th><td>{team.members}</td></tr>}
      {team.coach && <tr><th scope="row">{dict.contest.coach}</th><td>{team.coach}</td></tr>}
    </tbody></table>
  </ScoreboardDialog>;
}
