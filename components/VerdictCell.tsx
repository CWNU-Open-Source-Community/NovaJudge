"use client";

import { useState } from "react";
import LiveVerdict from "@/components/LiveVerdict";
import {
  XMarkIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { Verdict } from "@/lib/generated/prisma/enums";
import VerdictBadge from "./VerdictBadge";
import { useLanguage } from "@/context/LanguageContext";
import { getVerdictLabel } from "@/lib/dictionaries";

interface VerdictCellProps {
  submission: {
    id: string;
    verdict: string;
    passedTests: number;
    totalTests: number;
    errorMessage?: string | null;
  };
  isGuest?: boolean;
  showTestDetails?: boolean;
}

export default function VerdictCell({
  submission,
  isGuest = false,
  showTestDetails = true,
}: VerdictCellProps) {
  const { dict } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);

  if (submission.verdict === "FROZEN") {
    return <VerdictBadge status="FROZEN" />;
  }

  if (isGuest) {
    if (submission.verdict === Verdict.ACCEPTED) {
      return <VerdictBadge status={Verdict.ACCEPTED} />;
    } else {
      return <VerdictBadge status="REJECTED" />;
    }
  }

  // 如果不是编译错误，或者没有错误信息，直接显示普通状态
  if (
    submission.verdict !== Verdict.COMPILE_ERROR ||
    !submission.errorMessage
  ) {
    return (
      <LiveVerdict
        key={`${submission.id}-${submission.verdict}`}
        submissionId={submission.id}
        initialStatus={submission.verdict}
        initialPassed={submission.passedTests}
        initialTotal={submission.totalTests}
        showTestDetails={showTestDetails}
      />
    );
  }

  // 如果是编译错误，显示可点击的按钮和弹窗
  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="inline-flex group relative items-center gap-1.5 text-yellow-600 hover:text-yellow-800 transition-colors cursor-pointer"
        title={dict.submission.viewCompilationError}
      >
        <ExclamationTriangleIcon className="w-4 h-4" />
        <span className="text-sm whitespace-nowrap font-bold border-b border-dashed border-yellow-600 group-hover:border-yellow-800 text-center">
          {getVerdictLabel(Verdict.COMPILE_ERROR)}
        </span>
      </button>

      {/* 简单的错误详情弹窗 */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl flex flex-col max-h-[80vh] animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center px-6 py-4 border-b">
              <h3 className="text-lg font-bold text-red-600 flex items-center gap-2">
                <ExclamationTriangleIcon className="w-5 h-5" />
                {dict.submission.compilationError}
              </h3>
              <button
                onClick={() => setIsOpen(false)}
                aria-label={dict.common.close}
                className="text-gray-400 cursor-pointer hover:text-gray-600"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 overflow-auto bg-gray-50 font-mono text-sm whitespace-pre-wrap text-left text-gray-800">
              {submission.errorMessage}
            </div>
            <div className="px-6 py-3 border-t bg-gray-50 rounded-b-lg flex justify-end">
              <button
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded cursor-pointer hover:bg-gray-300 font-medium text-sm"
              >
                {dict.common.close}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
