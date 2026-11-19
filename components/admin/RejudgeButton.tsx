"use client";

import { useAdminLocale } from "@/components/admin/useAdminLocale";

import { useTransition, useState } from "react";
import { rejudgeSubmission } from "@/app/admin/submissions/actions";
import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import ConfirmModal from "./ConfirmModal";

export default function RejudgeButton({
  submissionId,
  verdict,
}: {
  submissionId: string;
  verdict: string;
}) {
  const { t } = useAdminLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const handleRejudge = () => {
    setIsConfirmOpen(true);
  };

  const confirmRejudge = async () => {
    setIsConfirmOpen(false);
    startTransition(async () => {
      try {
        // 调用 Server Action
        const result = await rejudgeSubmission(submissionId, verdict === "ACCEPTED");

        if (result?.error) {
          toast.error(result.error);
          router.refresh();
          return;
        }

        // 强制刷新当前路由
        router.refresh();
        toast.success(t("Rejudge request sent", "已发送重判请求"));
      } catch (error) {
        toast.error(t("Failed to rejudge", "重判失败"));
        console.error(error);
      }
    });
  };

  return (
    <>
      <ConfirmModal cancelText={t("Cancel", "取消")}
        isOpen={isConfirmOpen}
        title={t("Rejudge Submission", "重判提交")}
        message={verdict === "ACCEPTED"
          ? t("This submission is accepted. Rejudging may change its result. Continue?", "该提交已 AC。确认重新评测这条提交？结果可能发生变化。")
          : t("Rejudge this submission?", "确认重新评测这条提交？")}
        confirmText={verdict === "ACCEPTED" ? t("Rejudge AC", "确认重判 AC") : t("Confirm rejudge", "确认重判")}
        isDestructive={verdict === "ACCEPTED"}
        onConfirm={confirmRejudge}
        onCancel={() => setIsConfirmOpen(false)}
      />
      <button
        onClick={handleRejudge}
        disabled={isPending || verdict === "PENDING" || verdict === "JUDGING"}
        className="text-blue-600 hover:text-blue-900 disabled:opacity-50 disabled:cursor-not-allowed p-1 rounded hover:bg-blue-50 transition-colors cursor-pointer"
        title={t("Rejudge", "重判")}
        aria-label={t("Rejudge this submission", "重判此提交")}
      >
        <ArrowPathIcon
          className={`w-5 h-5 ${isPending ? "animate-spin" : ""}`}
        />
      </button>
    </>
  );
}
