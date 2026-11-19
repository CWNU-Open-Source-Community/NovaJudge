"use client";

import { useAdminLocale } from "@/components/admin/useAdminLocale";

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
  const { t } = useAdminLocale();
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
        toast.success(nextIsBanned ? t("User banned", "用户已封禁") : t("User unbanned", "用户已解封"));
        router.refresh();
      } catch (error) {
        console.error(error);
        toast.error(nextIsBanned ? t("Failed to ban user", "封禁失败") : t("Failed to unban user", "解封失败"));
      }
    });
  }

  return (
    <>
      <ConfirmModal cancelText={t("Cancel", "取消")}
        isOpen={isConfirmOpen}
        title={nextIsBanned ? t("Ban external user", "封禁外部用户") : t("Unban external user", "解除封禁")}
        message={
          nextIsBanned
            ? t(`Ban external user ${username}? This disables the account's external sign-in.`, `确认封禁外部用户 ${username}？该账号将失去外部登录权限。`)
            : t(`Unban ${username}?`, `确认解除 ${username} 的封禁？`)
        }
        confirmText={nextIsBanned ? t("Ban", "封禁") : t("Unban", "解封")}
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
        {isBanned ? t("Unban", "解封") : t("Ban", "封禁")}
      </button>
    </>
  );
}
