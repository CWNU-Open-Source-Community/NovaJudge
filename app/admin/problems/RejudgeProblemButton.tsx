"use client";

import { useAdminLocale } from "@/components/admin/useAdminLocale";

import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { rejudgeProblem } from "./actions"; // 确保这里能导入 rejudgeProblem 或者将其通过 props 传递
import { useState } from "react";
import ConfirmModal from "@/components/admin/ConfirmModal";
import { toast } from "sonner";

export default function RejudgeButton({ problemId }: { problemId: number }) {
  const { t } = useAdminLocale();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const handleRejudge = () => {
    setIsConfirmOpen(true);
  };

  const confirmRejudge = async () => {
    setIsConfirmOpen(false);
    const result = await rejudgeProblem(problemId);
    const message = `已入队 ${result?.queued ?? 0} 条，跳过 ${result?.skipped ?? 0} 条，入队失败 ${result?.failed ?? 0} 条`;

    if (result?.error) {
      toast.error(`${result.error} ${message}`);
      return;
    }

    if (result?.failed) toast.error(message);
    else toast.success(message);
  };

  return (
    <>
      <ConfirmModal cancelText={t("Cancel", "取消")}
        isOpen={isConfirmOpen}
        title={t("Rejudge Problem", "重判题目")}
        message={t(`Rejudge all non-AC submissions for problem #${problemId}?`, `确认重判题目 #${problemId} 的所有未通过提交？`)}
        confirmText={t("Rejudge Non-AC", "重判非 AC 提交")}
        onConfirm={confirmRejudge}
        onCancel={() => setIsConfirmOpen(false)}
      />
      <button
        onClick={handleRejudge}
        className="admin-icon-button text-green-600 hover:text-green-800"
        title={t("Rejudge Non-AC Submissions", "重判未通过的提交")}
        type="button"
      >
        <ArrowPathIcon className="size-[18px]" aria-hidden="true" />
      </button>
    </>
  );
}
