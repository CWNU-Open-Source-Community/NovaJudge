"use client";
import { useEffect } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/context/LanguageContext";
import { useContestInterface } from "./contest/ContestInterface";
import { notifyContestant } from "@/lib/domjudge-notifications";

export default function ContestNoticeSniffer({
  contestId,
}: {
  contestId: number;
}) {
  const router = useRouter();
  const mode = useContestInterface();
  const teamInterface = mode !== null;
  const { dict: { clarifications } } = useLanguage();

  useEffect(() => {
    const checkNotice = async () => {
      try {
        const res = await fetch(`/api/contests/${contestId}/latest-notice`);
        const json = await res.json();

        if (json.success && json.data) {
          const latest = json.data;
          const storageKey = `contest_${contestId}_last_notice_id`;
          const lastSeenId = localStorage.getItem(storageKey);

          if (!lastSeenId || parseInt(lastSeenId) < latest.id) {
            if (mode === "domjudge") {
              if (lastSeenId) notifyContestant("New clarification", latest.title ?? "Contest announcement",
                `/contest/${contestId}/clarifications/${latest.id}`);
              localStorage.setItem(storageKey, String(latest.id));
              return;
            }
            toast.info(`📢 ${clarifications.newAnnouncement}`, {
              description: latest.title,
              position: teamInterface ? "bottom-right" : "top-right",
              closeButton: teamInterface,
              duration: Infinity,
              action: {
                label: clarifications.viewAnnouncement,
                onClick: () => {
                  router.push(`/contest/${contestId}/clarifications`);
                },
              },
            });

            localStorage.setItem(storageKey, latest.id.toString());
          }
        }
      } catch (error) {
        console.log(error);
      }
    };

    checkNotice();

    const interval = setInterval(checkNotice, 15000);
    return () => clearInterval(interval);
  }, [clarifications, contestId, mode, router, teamInterface]);

  return null;
}
