"use client";

import { useAdminLocale } from "@/components/admin/useAdminLocale";

import { TrashIcon } from "@heroicons/react/24/outline";
import { deleteProblem } from "./actions";
import { useState } from "react";
import ConfirmModal from "@/components/admin/ConfirmModal";

export default function RejudgeButton({ problemId }: { problemId: number }) {
  const { t } = useAdminLocale();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const handleDelete = () => {
    setIsConfirmOpen(true);
  };

  const confirmDelete = async () => {
    setIsConfirmOpen(false);
    await deleteProblem(problemId);
  };

  return (
    <>
      <ConfirmModal cancelText={t("Cancel", "取消")}
        isOpen={isConfirmOpen}
        title={t("Delete Problem", "删除题目")}
        message={t(`Delete problem #${problemId}?`, `确认删除题目 #${problemId}？`)}
        confirmText={t("Delete", "删除")}
        onConfirm={confirmDelete}
        onCancel={() => setIsConfirmOpen(false)}
        isDestructive
      />
      <button
        onClick={handleDelete}
        className="admin-icon-button text-red-400 hover:text-red-600"
        title={t("Delete Problem", "删除题目")}
        type="button"
      >
        <TrashIcon className="size-[18px]" aria-hidden="true" />
      </button>
    </>
  );
}
