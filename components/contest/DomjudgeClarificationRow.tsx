"use client";

import { useSyncExternalStore, type ReactNode } from "react";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("domjudge-read", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("domjudge-read", callback);
  };
}

// Remember the version the team opened. A later jury reply makes the thread bold again.
export default function DomjudgeClarificationRow({ storageKey, activity, children }: {
  storageKey: string; activity: number; children: ReactNode;
}) {
  const seenAt = useSyncExternalStore(subscribe, () => {
    try { return Number(localStorage.getItem(storageKey) ?? 0); } catch { return 0; }
  }, () => 0);
  return <tr className={seenAt < activity ? "dj-unread" : undefined} onClick={event => {
    if (!(event.target instanceof Element) || !event.target.closest("a")) return;
    try {
      localStorage.setItem(storageKey, String(activity));
      window.dispatchEvent(new Event("domjudge-read"));
    } catch { /* Reading a message still works with browser storage disabled. */ }
  }}>{children}</tr>;
}
