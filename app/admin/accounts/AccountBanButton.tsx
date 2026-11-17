"use client";

import ConfirmModal from "@/components/admin/ConfirmModal";
import { LockClosedIcon, LockOpenIcon } from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setExternalAccountBanStatus } from "./actions";

export default function AccountBanButton({
  userId,
  username,
  isBanned,
}: {
  userId: string;
  username: string;
  isBanned: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const nextIsBanned = !isBanned;

  function handleClick() {
    setIsConfirmOpen(true);
  }

  function handleConfirm() {
    setIsConfirmOpen(false);
    startTransition(async () => {
      try {
        await setExternalAccountBanStatus(userId, nextIsBanned);
        toast.success(nextIsBanned ? "用户已封禁" : "用户已解封");
        router.refresh();
      } catch (error) {
        console.error(error);
        toast.error(nextIsBanned ? "封禁失败" : "解封失败");
      }
    });
  }

  return (
    <>
      <ConfirmModal
        isOpen={isConfirmOpen}
        title={nextIsBanned ? "封禁外部用户" : "解除封禁"}
        message={
          nextIsBanned
            ? `确定要封禁外部用户 ${username} 吗？封禁后该账号的外部登录会失效。`
            : `确定要解除 ${username} 的封禁状态吗？`
        }
        confirmText={nextIsBanned ? "封禁" : "解封"}
        onConfirm={handleConfirm}
        onCancel={() => setIsConfirmOpen(false)}
        isDestructive={nextIsBanned}
      />

      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          isBanned
            ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            : "bg-red-50 text-red-700 hover:bg-red-100"
        }`}
      >
        {isBanned ? (
          <LockOpenIcon className="h-4 w-4" />
        ) : (
          <LockClosedIcon className="h-4 w-4" />
        )}
        {isBanned ? "解封" : "封禁"}
      </button>
    </>
  );
}
