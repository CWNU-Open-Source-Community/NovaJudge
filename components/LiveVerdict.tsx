"use client";

import { useState, useEffect, useRef } from "react";
import { Verdict } from "@/lib/generated/prisma/enums";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationCircleIcon,
  ClockIcon,
} from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";
import { getVerdictLabel } from "@/lib/dictionaries";
import { notifyContestant } from "@/lib/domjudge-notifications";
import { verdictPillClass } from "@/lib/verdict-style";
import { announceAccepted, type AcceptedEventDetail } from "@/lib/accepted-event";

import { domjudgeResult } from "@/lib/domjudge-verdict";
import DomjudgeSubmissionResult from "./contest/DomjudgeSubmissionResult";

// 复用你的配置表
const VERDICT_CONFIG: Record<
  string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { color: string; icon?: any }
> = {
  [Verdict.PENDING]: { color: "text-gray-500" },
  [Verdict.JUDGING]: { color: "text-blue-600" },
  [Verdict.ACCEPTED]: {
    color: "text-green-600 font-bold",
    icon: CheckCircleIcon,
  },
  [Verdict.WRONG_ANSWER]: {
    color: "text-red-600 font-bold",
    icon: XCircleIcon,
  },
  [Verdict.TIME_LIMIT_EXCEEDED]: {
    color: "text-orange-600 font-bold",
    icon: ClockIcon,
  },
  [Verdict.MEMORY_LIMIT_EXCEEDED]: {
    color: "text-orange-600 font-bold",
    icon: ExclamationCircleIcon,
  },
  [Verdict.RUNTIME_ERROR]: {
    color: "text-purple-600 font-bold",
    icon: ExclamationCircleIcon,
  },
  [Verdict.COMPILE_ERROR]: {
    color: "text-yellow-600 font-bold",
    icon: ExclamationCircleIcon,
  },
  [Verdict.PRESENTATION_ERROR]: {
    color: "text-orange-500 font-bold",
    icon: ExclamationCircleIcon,
  },
  [Verdict.SYSTEM_ERROR]: {
    color: "text-gray-900 font-bold",
    icon: ExclamationCircleIcon,
  },
};

interface LiveVerdictProps {
  submissionId: string;
  initialStatus: string;
  initialPassed?: number;
  initialTotal?: number;
  showTestDetails?: boolean;
  domjudgeHref?: string;
  /** Raise the accepted celebration when this submission becomes accepted. */
  celebrate?: AcceptedEventDetail;
}

export default function LiveVerdict({
  submissionId,
  initialStatus,
  initialPassed = 0,
  initialTotal = 0,
  showTestDetails = true,
  domjudgeHref,
  celebrate,
}: LiveVerdictProps) {
  const [status, setStatus] = useState(initialStatus);
  const [passed, setPassed] = useState(initialPassed);
  const [, setTotal] = useState(initialTotal);
  const router = useRouter();
  // Read the latest value inside the SSE handler without reconnecting.
  const celebrateRef = useRef(celebrate);
  useEffect(() => {
    celebrateRef.current = celebrate;
  });

  // useEffect(() => {
  //   // 只有在 PENDING 或 JUDGING 状态下才轮询
  //   if (status !== Verdict.PENDING && status !== Verdict.JUDGING) return;
  //   let isMounted = true;
  //   // eslint-disable-next-line prefer-const
  //   let interval: NodeJS.Timeout;
  //   // --- 核心逻辑：定义轮询函数 ---
  //   const fetchData = async () => {
  //     try {
  //       const res = await fetch(`/api/submission/${submissionId}`);
  //       if (!res.ok) return;

  //       const data = await res.json();

  //       if (isMounted) {
  //         setStatus(data.verdict);
  //         setPassed(data.passedTests);
  //         setTotal(data.totalTests);

  //         // 如果判题结束，停止轮询
  //         if (
  //           data.verdict !== Verdict.PENDING &&
  //           data.verdict !== Verdict.JUDGING
  //         ) {
  //           clearInterval(interval);
  //           router.refresh();
  //         }
  //       }
  //     } catch (e) {
  //       console.error("Polling error", e);
  //     }
  //   };
  //   // 1. 挂载后立即执行一次！不要等 setInterval 的第一秒
  //   fetchData();

  //   // 2. 然后再开启定时器
  //   interval = setInterval(fetchData, 1000);

  //   return () => {
  //     isMounted = false;
  //     clearInterval(interval);
  //   };
  // }, [router, status, submissionId]);

  // --- 渲染逻辑 ---

  useEffect(() => {
    // 如果初始状态已经是终态，则无需建立连接
    if (
      initialStatus !== Verdict.PENDING &&
      initialStatus !== Verdict.JUDGING
    ) {
      return;
    }

    // 建立 SSE 连接
    const eventSource = new EventSource(
      `/api/submission/${submissionId}/stream`
    );

    eventSource.onopen = () => {
      console.log("SSE Connected");
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        setStatus(data.verdict);
        setPassed(data.passedTests);
        setTotal(data.totalTests);

        // 检测终态
        if (
          data.verdict !== Verdict.PENDING &&
          data.verdict !== Verdict.JUDGING
        ) {
          eventSource.close(); // 关闭连接
          if (domjudgeHref) notifyContestant("Submission judged", domjudgeResult[data.verdict] ?? data.verdict, domjudgeHref);
          else if (celebrateRef.current && data.verdict === Verdict.ACCEPTED) announceAccepted(celebrateRef.current);
          router.refresh(); // 刷新页面数据
        }
      } catch (err) {
        console.error("SSE parse error", err);
      }
    };

    eventSource.onerror = () => {
      // EventSource reconnects on transient errors. Recheck access if the server closed it permanently.
      if (eventSource.readyState === EventSource.CLOSED) router.refresh();
    };

    // 组件卸载时关闭连接
    return () => {
      eventSource.close();
    };
  }, [router, submissionId, initialStatus, domjudgeHref]);

  const isLoading = status === Verdict.PENDING || status === Verdict.JUDGING;
  if (domjudgeHref) {
    return <DomjudgeSubmissionResult result={domjudgeResult[status] ?? status} announce={isLoading} />;
  }
  const Icon = VERDICT_CONFIG[status]?.icon;

  const displayText = getVerdictLabel(status, showTestDetails ? passed + 1 : undefined);

  return (
    <span className={verdictPillClass(status)}>
      {/* 1. Loading 动画 */}
      {isLoading && <ArrowPathIcon className="w-4 h-4 motion-safe:animate-spin" />}

      {/* 2. 静态图标 */}
      {!isLoading && Icon && <Icon className="w-4 h-4" />}

      {/* 3. 动态文本 */}
      <span>{displayText}</span>
    </span>
  );
}
