"use client";

import { useState } from "react";
import { unfreezeContest } from "./actions";
import { useRouter } from "next/navigation";
import { Contest } from "@/lib/generated/prisma/client";
import { ContestConfig } from "@/app/(main)/page";
import { toast } from "sonner";
import ConfirmModal from "@/components/admin/ConfirmModal";

export default function UnfreezeButton({ contest }: { contest: Pick<Contest, "id" | "config"> }) {
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
        toast.success("Board unfrozen successfully!");
        router.refresh();
      } else {
        toast.error(res.error || "Failed to unfreeze");
      }
    } catch (e) {
      console.log(e);
      toast.error("Error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <ConfirmModal
        isOpen={isConfirmOpen}
        title="Unfreeze Scoreboard"
        message="Are you sure you want to unfreeze the scoreboard? This will reveal the final standings."
        confirmText="Unfreeze"
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
        {loading ? "Processing..." : "🔓 Unfreeze Board"}
      </button>
    </>
  );
}
