"use client";

import { useEffect, useRef } from "react";
import { notifyContestant } from "@/lib/domjudge-notifications";
import DomjudgeRefresh from "./DomjudgeRefresh";

export default function DomjudgeHomeUpdates({ contestId, latest }: {
  contestId: number; latest?: { id: number; time: number; text: string };
}) {
  const latestVersion = latest && `${latest.id}:${latest.time}`;
  const previous = useRef(latestVersion);
  useEffect(() => {
    if (latest && previous.current !== latestVersion) {
      notifyContestant("New clarification", latest.text, `/contest/${contestId}/clarifications/${latest.id}`);
    }
    previous.current = latestVersion;
  }, [contestId, latest, latestVersion]);
  return <DomjudgeRefresh />;
}
