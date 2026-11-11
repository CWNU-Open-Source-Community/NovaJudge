"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { BellIcon } from "@heroicons/react/24/outline";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import type { ClarificationNotificationFeed } from "@/lib/clarification-notifications";

const POLL_INTERVAL = 10_000;

export default function ClarificationNotifications() {
  const { user } = useAuth();
  if (!user || user.isGlobalAdmin || !user.contestId || !["ADMIN", "JUDGE"].includes(user.role)) return null;

  // Remount when accounts change so one user's questions cannot linger in
  // another user's menu while the next authenticated request is in flight.
  return <NotificationBell key={`${user.isGlobalAdmin}:${user.contestId}:${user.username}:${user.role}`} />;
}

function NotificationBell() {
  const { dict, lang } = useLanguage();
  const labels = dict.clarificationNotifications;
  const pathname = usePathname();
  const router = useRouter();
  const [feed, setFeed] = useState<ClarificationNotificationFeed | null>(null);
  const [failed, setFailed] = useState(false);
  const [denied, setDenied] = useState(false);
  const seenInMemory = useRef(new Map<string, Set<string>>());

  useEffect(() => {
    let disposed = false;
    let running = false;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let request: AbortController | undefined;
    let activeToast: string | undefined;
    let activeEvent: string | undefined;

    const poll = async () => {
      if (disposed || running || stopped) return;
      clearTimeout(timer);
      running = true;
      request = new AbortController();
      const timeout = setTimeout(() => request?.abort(), POLL_INTERVAL);

      try {
        const response = await fetch("/api/clarifications/notifications", {
          cache: "no-store",
          signal: request.signal,
        });
        if (disposed) return;
        if (response.status === 401 || response.status === 403) {
          setFeed(null);
          setDenied(true);
          stopped = true;
          if (activeToast) toast.dismiss(activeToast);
          return;
        }
        if (!response.ok) throw new Error("Notification request failed");
        const next: ClarificationNotificationFeed = await response.json();
        if (disposed) return;
        setFeed(next);
        setFailed(false);

        const storageKey = `clarification-notifications:${next.viewerKey}`;
        let seen = seenInMemory.current.get(storageKey) ?? new Set<string>();
        try {
          const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
          if (Array.isArray(saved) && saved.every((key) => typeof key === "string")) {
            seen = new Set(saved);
          }
        } catch { /* Notifications still work when browser storage is disabled. */ }

        const fresh = next.questions.filter((question) => !seen.has(question.eventKey));
        const currentEvents = new Set(next.questions.map((question) => question.eventKey));
        if (activeEvent && !currentEvents.has(activeEvent) && activeToast) {
          toast.dismiss(activeToast);
          activeEvent = undefined;
        }
        if (fresh.length > 0) {
          const question = fresh[0];
          const href = `/contest/${question.contestId}/clarifications/${question.id}`;
          activeToast = `clarification-notifications:${next.viewerKey}`;
          activeEvent = question.eventKey;
          toast.info(labels.newQuestions.replace("{count}", String(fresh.length)), {
            id: activeToast,
            description: `${question.contestTitle} · ${question.title || labels.untitled}`,
            position: "bottom-right",
            duration: Infinity,
            closeButton: true,
            action: {
              label: labels.viewQuestion,
              onClick: () => {
                if (pathname === href) router.refresh();
                else router.push(href);
              },
            },
          });
        }

        // Remember displayed alerts per account, while the pending badge stays
        // until a judge replies. Retain only the current bounded feed.
        seenInMemory.current.set(storageKey, currentEvents);
        try {
          localStorage.setItem(storageKey, JSON.stringify([...currentEvents]));
        } catch { /* Keep the in-memory fallback. */ }
      } catch {
        if (!disposed) setFailed(true);
      } finally {
        clearTimeout(timeout);
        running = false;
        if (!disposed && !stopped) timer = setTimeout(poll, POLL_INTERVAL);
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    void poll();
    window.addEventListener("focus", poll);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      clearTimeout(timer);
      request?.abort();
      window.removeEventListener("focus", poll);
      document.removeEventListener("visibilitychange", onVisible);
      if (activeToast) toast.dismiss(activeToast);
    };
  }, [labels, pathname, router]);

  if (denied) return null;
  const total = feed?.total ?? 0;
  const title = labels.pending.replace("{count}", String(total));

  return (
    <Popover className="relative shrink-0 font-sans">
      {({ close }) => (
        <>
          <PopoverButton
            aria-label={feed ? title : labels.title}
            title={feed ? title : labels.title}
            onClick={() => {
              if (feed) toast.dismiss(`clarification-notifications:${feed.viewerKey}`);
            }}
            className="relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-gray-600 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            <BellIcon aria-hidden="true" className="h-6 w-6" />
            {total > 0 && (
              <span aria-hidden="true" className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1 text-center text-xs font-bold leading-5 text-white">
                {total > 99 ? "99+" : total}
              </span>
            )}
          </PopoverButton>
          <PopoverPanel
            anchor="bottom end"
            className="z-50 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-gray-200 bg-white font-sans shadow-lg [--anchor-gap:12px] [--anchor-padding:16px] focus:outline-none"
          >
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-bold text-gray-900">{labels.title}</h2>
              <p className="mt-1 text-xs text-gray-500">{feed ? title : dict.common.loading}</p>
            </div>
            {failed && <p role="status" className="px-4 py-3 text-sm text-amber-700">{labels.failed}</p>}
            {feed && total === 0 && <p className="px-4 py-6 text-sm text-gray-500">{labels.empty}</p>}
            <ul className="max-h-[min(28rem,60vh)] divide-y divide-gray-100 overflow-y-auto">
              {feed?.questions.map((question) => {
                const href = `/contest/${question.contestId}/clarifications/${question.id}`;
                return (
                  <li key={question.id}>
                    <Link
                      href={href}
                      prefetch={false}
                      onClick={() => {
                        close();
                        if (pathname === href) router.refresh();
                      }}
                      className="block px-4 py-3 hover:bg-blue-50 focus-visible:bg-blue-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600"
                    >
                      <p className="truncate text-xs font-medium text-blue-700">#{question.contestId} · {question.contestTitle}</p>
                      <p className="mt-1 wrap-break-word text-sm font-semibold text-gray-900">{question.title || labels.untitled}</p>
                      <p className="mt-1 truncate text-xs text-gray-500">
                        {question.authorName} · {question.displayId ? `${labels.problem} ${question.displayId}` : dict.clarifications.general}
                      </p>
                      <time dateTime={question.activityAt} className="mt-1 block text-xs text-gray-400">
                        {new Date(question.activityAt).toLocaleString(lang === "zh" ? "zh-CN" : "en-US")}
                      </time>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {feed && total > feed.questions.length && (
              <p className="border-t border-gray-100 px-4 py-3 text-xs text-gray-500">
                {labels.more.replace("{shown}", String(feed.questions.length)).replace("{total}", String(total))}
              </p>
            )}
          </PopoverPanel>
        </>
      )}
    </Popover>
  );
}
