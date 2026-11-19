"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import {
  faBars, faBookOpen, faCloudUploadAlt, faFileAlt, faHome, faLanguage, faListOl, faSignOutAlt,
} from "@fortawesome/free-solid-svg-icons";
import type { ContestNavItem } from "@/components/Navbar";
import ContestTimer from "@/components/ContestTimer";
import type { DomjudgeContest } from "@/lib/domjudge-contest";
import { ContestInterfaceSwitch } from "./ContestInterface";
import DomjudgeIcon from "./DomjudgeIcon";
import DomjudgeNotificationButton from "./DomjudgeNotificationButton";

interface Props {
  contest: DomjudgeContest;
  items: ContestNavItem[];
  onPrint: () => void;
  onSubmit: () => void;
  onLogout: () => void;
}

export default function DomjudgeMenu({ contest, items, onPrint, onSubmit, onLogout }: Props) {
  const [expanded, setExpanded] = useState(false);
  const pathname = usePathname();
  const base = `/contest/${contest.id}`;
  const links = [
    { label: "Home", path: "", icon: faHome },
    { label: "Problemset", path: "/problems", icon: faBookOpen },
    { label: "Languages", path: "/languages", icon: faLanguage },
    { label: "Print", action: onPrint, icon: faFileAlt },
    { label: "Scoreboard", path: "/rank", icon: faListOl },
  ];

  return <nav className="dj-bar" aria-label="Contest navigation" lang="en">
    <div className="dj-nav-row">
      <Popover className="dj-brand-menu">
        <PopoverButton className="dj-brand" title="Contest menu · Switch interface" aria-label="DOMjudge contest menu">DOMjudge</PopoverButton>
        <PopoverPanel className="dj-menu-panel">
          {({ close }) => <>
            <ContestInterfaceSwitch />
            <Link href={`${base}/clarifications`} onClick={() => close()}>Clarifications</Link>
            {items.some(item => item.key === "editorial") &&
              <Link href={`${base}/editorial`} onClick={() => close()}>Editorial</Link>}
            <Link href="/" onClick={() => close()}>Contests</Link>
          </>}
        </PopoverPanel>
      </Popover>
      <button type="button" className="dj-nav-toggle" aria-controls="dj-navigation" aria-expanded={expanded}
        aria-label="Toggle navigation" onClick={() => setExpanded(!expanded)}><DomjudgeIcon icon={faBars} /></button>
      <div className="dj-navigation" id="dj-navigation" data-expanded={expanded}>
        <div className="dj-links">
          {links.map(({ label, path, icon, action }) => {
            const content = <><DomjudgeIcon icon={icon} />{label}</>;
            if (action) return <button key={label} type="button" onClick={() => { setExpanded(false); action(); }}>{content}</button>;
            if (path === "/problems" && !contest.started) return <span key={label} aria-disabled="true">{content}</span>;
            const href = base + path;
            const active = pathname === href || (path && pathname.startsWith(href + "/"));
            return <Link key={label} href={href} aria-current={active ? "page" : undefined}
              onClick={() => setExpanded(false)}>{content}</Link>;
          })}
        </div>
        <div className="dj-actions">
          <DomjudgeNotificationButton />
          <button type="button" className="dj-action dj-success" disabled={!contest.started}
            title={contest.canSubmit ? "Submit a solution" : "Submissions are closed"}
            onClick={() => { setExpanded(false); onSubmit(); }}><DomjudgeIcon icon={faCloudUploadAlt} />Submit</button>
          <button type="button" className="dj-action dj-logout" onClick={onLogout}><DomjudgeIcon icon={faSignOutAlt} />Logout</button>
          <ContestTimer domjudgeState={contest} startTime={new Date(contest.start)} endTime={new Date(contest.end)} />
        </div>
      </div>
    </div>
  </nav>;
}
