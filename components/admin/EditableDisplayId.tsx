// components/admin/EditableDisplayId.tsx
"use client";

import { useAdminLocale } from "@/components/admin/useAdminLocale";

import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { updateProblemDisplayId } from "@/app/admin/contests/[id]/problems/actions";

interface Props {
  contestProblemId: number;
  contestId: number;
  initialDisplayId: string;
}

export default function EditableDisplayId({ contestProblemId, contestId, initialDisplayId }: Props) {
  const { t } = useAdminLocale();
  const [isEditing, setIsEditing] = useState(false);
  const [displayId, setDisplayId] = useState(initialDisplayId);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 自动聚焦
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  const handleSave = async () => {
    if (displayId === initialDisplayId) {
      setIsEditing(false);
      return;
    }

    setIsLoading(true);
    const res = await updateProblemDisplayId(contestProblemId, displayId, contestId);
    setIsLoading(false);

    if (res.error) {
      toast.error(res.error);
      setDisplayId(initialDisplayId);
    } else {
      toast.success(t("Problem ID updated", "题号更新成功"));
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setDisplayId(initialDisplayId);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={displayId}
        onChange={(e) => setDisplayId(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        disabled={isLoading}
        className="w-16 px-2 py-1 text-sm border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
      />
    );
  }

  return (
    <div 
      onClick={() => setIsEditing(true)}
      className="cursor-pointer px-2 py-1 rounded hover:bg-gray-100 border border-transparent hover:border-gray-300 transition-colors inline-block min-w-10 text-center"
      title={t("Edit problem ID", "点击修改题号")}
    >
      {initialDisplayId}
    </div>
  );
}
