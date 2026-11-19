"use client";

import { useAdminLocale } from "@/components/admin/useAdminLocale";

import { useState } from "react";
import { CheckIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { toast } from "sonner";
import { updateProblemColor } from "@/app/admin/contests/[id]/problems/actions";

interface Props {
  contestProblemId: string;
  contestId: number;
  initialColor: string | null;
}

const fallbackColor = "#000000";

export default function EditableProblemColor({
  contestProblemId,
  contestId,
  initialColor,
}: Props) {
  const { t } = useAdminLocale();
  const normalizedInitialColor = initialColor || fallbackColor;
  const [color, setColor] = useState(normalizedInitialColor);
  const [savedColor, setSavedColor] = useState(normalizedInitialColor);
  const [isSaving, setIsSaving] = useState(false);

  const isDirty = color !== savedColor;

  const handleSave = async () => {
    if (!isDirty || isSaving) return;

    setIsSaving(true);
    const res = await updateProblemColor(contestProblemId, color, contestId);
    setIsSaving(false);

    if (res.error) {
      toast.error(res.error);
      setColor(savedColor);
      return;
    }

    setSavedColor(color);
    toast.success(t("Color updated", "已更新颜色"));
  };

  const handleCancel = () => {
    setColor(savedColor);
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={color}
        onChange={(event) => setColor(event.target.value)}
        onBlur={handleSave}
        disabled={isSaving}
        className="h-8 w-10 cursor-pointer rounded border border-gray-300 bg-white p-0.5 disabled:cursor-not-allowed disabled:opacity-60"
        title={t("Change balloon color", "修改气球颜色")}
      />
      <span className="w-16 font-mono text-xs text-gray-500">{color}</span>
      {isDirty && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={handleSave}
            disabled={isSaving}
            className="rounded p-1 text-green-600 transition-colors hover:bg-green-50 hover:text-green-700 disabled:opacity-60"
            title={t("Save color", "保存颜色")}
          >
            <CheckIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={handleCancel}
            disabled={isSaving}
            className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-60"
            title={t("Cancel color change", "取消修改颜色")}
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
