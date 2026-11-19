"use client";

import { useLanguage } from "@/context/LanguageContext";

import { useState } from "react";
import { unfreezeContest } from "./actions";
import { useRouter } from "next/navigation";
import { Contest } from "@/lib/generated/prisma/client";
import { ContestConfig } from "@/app/(main)/page";
import { toast } from "sonner";
import ConfirmModal from "@/components/admin/ConfirmModal";

export default function UnfreezeButton({ contest }: { contest: Pick<Contest, "id" | "config"> }) {
  const { dict: { rank, rejudge, common } } = useLanguage();
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const handleUnfreeze = () => {
    setIsConfirmOpen(true);
  };

  const confirmUnfreeze = async () => {
    setIsConfirmOpen(false);
    setLoading(true);
    try {
      const res = await unfreezeContest(contest.id);
      if (res.success) {
        toast.success(rank.unfrozen);
        router.refresh();
      } else {
        toast.error(res.error ?? rank.unfreezeFailed);
      }
    } catch (e) {
      console.log(e);
      toast.error(rank.unfreezeFailed);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <ConfirmModal
        isOpen={isConfirmOpen}
        title={rank.unfreezeTitle}
        message={rank.unfreezeDescription}
        confirmText={rank.unfreeze}
        cancelText={common.cancel}
        onConfirm={confirmUnfreeze}
        onCancel={() => setIsConfirmOpen(false)}
      />
      <button
        onClick={handleUnfreeze}
        disabled={
          loading || (contest.config as ContestConfig)?.frozenDuration === 0
        }
        className="ml-4 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded shadow transition-colors disabled:opacity-50 flex items-center gap-1 cursor-pointer"
      >
        {loading ? rejudge.processing : `🔓 ${rank.unfreeze}`}
      </button>
    </>
  );
}
