"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { useLanguage } from "@/context/LanguageContext";
import { formatMessage } from "@/lib/dictionaries";
import { ACCEPTED_EVENT, type AcceptedEventDetail } from "@/lib/accepted-event";

const BALLOON_PATH =
  "M391 307.27c32.75-46.35 46.59-101.63 39-155.68C416.47 55.59 327.38-11.54 231.38 2S68.24 104.53 81.73 200.53c7.57 53.89 36.12 103.16 80.37 138.74c26.91 21.64 57.59 36.1 86.05 41.33l-8.36 45.23a8 8 0 0 0 9 9.38L279 431c15.9 35.87 41.65 60.48 78.41 75l14.88 5.88l11.77-29.75l-14.88-5.89c-26.35-10.42-44.48-26.16-57-49.92l21.84-3.07a8 8 0 0 0 6.05-11.49l-20.49-41.16c25.98-12.87 51.49-35.18 71.42-63.33m-160.82 15.66c-41.26-16.32-76.3-52.7-91.45-94.94l-5.4-15.06l30.12-10.8l5.4 15.06c14.5 40.44 47.27 65.77 73.1 76l14.88 5.88l-11.77 29.76Z";

interface Balloon {
  left: number;
  size: number;
  delay: number;
  duration: number;
  sway: number;
}

interface Burst {
  id: number;
  color: string;
  balloons: Balloon[];
}

let nextBurstId = 0;

/** Releases balloons in the problem's colour when the viewer's submission is accepted. */
export default function BalloonCelebration() {
  const { dict } = useLanguage();
  const [bursts, setBursts] = useState<Burst[]>([]);

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const onAccepted = (event: Event) => {
      const { problem, color } = (event as CustomEvent<AcceptedEventDetail>).detail ?? {};
      toast.success(formatMessage(dict.contest.acceptedCelebration, { problem: problem ?? "" }));

      const id = ++nextBurstId;
      const balloons = Array.from({ length: 6 }, (_, index) => ({
        left: 6 + index * 15 + Math.random() * 8,
        size: 56 + Math.random() * 36,
        delay: Math.random() * 0.7,
        duration: 3 + Math.random() * 1.4,
        sway: (Math.random() - 0.5) * 120,
      }));
      setBursts(current => [...current, { id, color: color?.trim() || "#22c55e", balloons }]);
      const timer = setTimeout(() => {
        timers.delete(timer);
        setBursts(current => current.filter(burst => burst.id !== id));
      }, 5500);
      timers.add(timer);
    };

    window.addEventListener(ACCEPTED_EVENT, onAccepted);
    return () => {
      window.removeEventListener(ACCEPTED_EVENT, onAccepted);
      timers.forEach(clearTimeout);
    };
  }, [dict]);

  if (bursts.length === 0) return null;

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-60 overflow-hidden print:hidden">
      {bursts.flatMap(burst => burst.balloons.map((balloon, index) => (
        <svg
          key={`${burst.id}-${index}`}
          viewBox="0 0 512 512"
          className="nova-balloon"
          width={balloon.size}
          height={balloon.size}
          style={{
            left: `${balloon.left}%`,
            color: burst.color,
            "--delay": `${balloon.delay}s`,
            "--duration": `${balloon.duration}s`,
            "--sway": `${balloon.sway}px`,
          } as CSSProperties}
        >
          <path fill="currentColor" d={BALLOON_PATH} />
        </svg>
      )))}
    </div>
  );
}
