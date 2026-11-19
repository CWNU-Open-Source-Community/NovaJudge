"use client";

import { useAdminLocale } from "@/components/admin/useAdminLocale";

import { TrashIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { toast } from "sonner";
import ConfirmModal from "@/components/admin/ConfirmModal";
import { deleteContest } from "./actions";

interface DeleteContestButtonProps {
  contestId: number;
  contestTitle: string;
  onDeleted: (contestId: number) => void;
}

export default function DeleteContestButton({
  contestId,
  contestTitle,
  onDeleted,
}: DeleteContestButtonProps) {
  const { t } = useAdminLocale();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function confirmDelete() {
    setIsDeleting(true);

    try {
      const result = await deleteContest(contestId);
      if (result?.error) {
        toast.error(result.error);
        return;
      }

      onDeleted(contestId);
      toast.success(t(`Deleted contest #${contestId}.`, `已删除比赛 #${contestId}。`));
      setIsConfirmOpen(false);
    } catch {
      toast.error(t("Failed to delete contest", "删除比赛失败"));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
      <ConfirmModal cancelText={t("Cancel", "取消")}
        isOpen={isConfirmOpen}
        title={t("Delete Contest", "删除比赛")}
        message={t(`Delete contest #${contestId}, "${contestTitle}"? This permanently removes the contest's teams, problem links, submissions, balloons, print jobs, and clarifications. Its problems remain in the problem bank.`, `确认删除比赛 #${contestId}「${contestTitle}」？比赛账号、题目关联、提交、气球队列、打印任务和答疑将永久删除，题库中的原题会保留。`)}
        confirmText={isDeleting ? t("Deleting...", "正在删除…") : t("Delete", "删除")}
        onConfirm={confirmDelete}
        onCancel={() => setIsConfirmOpen(false)}
        isDestructive
      />
      <button
        type="button"
        onClick={() => setIsConfirmOpen(true)}
        disabled={isDeleting}
        className="text-red-400 hover:text-red-600 disabled:text-gray-300"
        title={t("Delete Contest", "删除比赛")}
      >
        <TrashIcon className="w-5 h-5" />
      </button>
    </>
  );
}
