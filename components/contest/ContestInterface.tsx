"use client";

import { createContext, useContext, useTransition, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ArrowsRightLeftIcon } from "@heroicons/react/24/outline";
import { useLanguage } from "@/context/LanguageContext";
import { setContestInterface } from "@/app/(main)/contest/interface-actions";

type ContestInterface = "domjudge" | "novajudge" | null;
const InterfaceContext = createContext<ContestInterface>(null);
export const useContestInterface = () => useContext(InterfaceContext);

export function SiteFrame({ team, navigation, footer, children }: {
  team: { contestId: number; domjudge: boolean } | null;
  navigation: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const route = pathname.match(/^\/contest\/(\d+)(?:\/(?:problems|languages|submit|status|rank|clarifications|editorial)(?:\/.*)?)?\/?$/);
  const teamPage = team && route && Number(route[1]) === team.contestId && !pathname.endsWith("/rank/print");
  const mode = teamPage ? (team.domjudge ? "domjudge" : "novajudge") : null;
  return (
    <InterfaceContext.Provider value={mode}>
      <div className="min-h-screen flex flex-col" data-contest-ui={mode}>
        {navigation}
        <main className={mode === "domjudge" ? "dj-main" : "flex justify-center w-full max-w-full mx-auto p-4 sm:p-6 lg:p-8 bg-zinc-100"}>
          {children}
        </main>
        {mode !== "domjudge" && footer}
      </div>
    </InterfaceContext.Provider>
  );
}

export function ContestInterfaceSwitch() {
  const mode = useContestInterface();
  const { dict } = useLanguage();
  const [pending, startTransition] = useTransition();
  if (!mode) return null;
  const domjudge = mode === "domjudge";
  const label = domjudge ? dict.domjudge.switchToNova : dict.domjudge.switchToDomjudge;
  return (
    <button type="button" disabled={pending} aria-label={label} title={label}
      className="contest-interface-switch"
      onClick={() => startTransition(() => setContestInterface(domjudge ? "novajudge" : "domjudge"))}>
      <ArrowsRightLeftIcon aria-hidden="true" className="size-4" />
      {domjudge ? "NovaJudge UI" : "DOMjudge UI"}
    </button>
  );
}
