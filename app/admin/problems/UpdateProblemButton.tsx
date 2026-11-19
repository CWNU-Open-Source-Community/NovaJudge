"use client";

import { useAdminLocale } from "@/components/admin/useAdminLocale";

import { Description, Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { ArrowUpTrayIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useId, useState, type ChangeEvent, type FormEvent } from "react";
import { toast } from "sonner";

interface UpdateProblemButtonProps {
  problemId: number;
  problemTitle: string;
  onUpdated: () => Promise<void>;
}

export default function UpdateProblemButton({
  problemId,
  problemTitle,
  onUpdated,
}: UpdateProblemButtonProps) {
  const { t } = useAdminLocale();
  const fileInputId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setFile(null);
    setError(null);
    setIsOpen(true);
  }

  function closeDialog() {
    if (!isUpdating) setIsOpen(false);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0] ?? null;
    setError(null);

    if (selectedFile && !selectedFile.name.toLowerCase().endsWith(".zip")) {
      setFile(null);
      event.target.value = "";
      setError(t("Please select a ZIP file containing exactly one problem.", "请选择只含一道题的 ZIP 文件。"));
      return;
    }

    setFile(selectedFile);
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isUpdating || !file) return;

    setIsUpdating(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`/api/problems/${problemId}/update`, {
        method: "POST",
        body: formData,
      });
      const result = await response.json().catch(() => null);

      if (!response.ok || result?.success !== true) {
        throw new Error(
          typeof result?.error === "string"
            ? result.error
            : "Update failed. Please try again.",
        );
      }

      toast.success(t(`Updated problem #${problemId}.`, `已更新题目 #${problemId}。`));
      setIsOpen(false);
      setFile(null);

      try {
        await onUpdated();
      } catch {
        toast.error(t("Problem updated, but the list could not be refreshed. Please reload the page.", "题目已更新，请刷新页面查看最新列表。"));
      }
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : t("Update failed. Please try again.", "更新失败，请重试。"),
      );
    } finally {
      setIsUpdating(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        disabled={isUpdating}
        className="admin-icon-button text-indigo-600 hover:text-indigo-800"
        title={t("Update Problem", "更新题目")}
        aria-label={t(`Update problem #${problemId}`, `更新题目 #${problemId}`)}
      >
        <ArrowUpTrayIcon className="size-[18px]" aria-hidden="true" />
      </button>

      <Dialog open={isOpen} onClose={closeDialog} className="relative z-50">
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" />
        <div className="fixed inset-0 overflow-y-auto p-4">
          <div className="flex min-h-full items-center justify-center">
            <DialogPanel className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-6 py-4">
                <DialogTitle className="font-bold text-gray-800">{t("Update Problem", "更新题目")}</DialogTitle>
                <button
                  type="button"
                  onClick={closeDialog}
                  disabled={isUpdating}
                  aria-label={t("Close update dialog", "关闭更新窗口")}
                  className="text-gray-400 hover:text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <XMarkIcon className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>

              <form onSubmit={handleUpdate} aria-busy={isUpdating}>
                <div className="space-y-4 p-6">
                  <Description className="break-words text-sm font-medium text-gray-900">
                    {t("Updating #", "正在更新题目 #")}{problemId}: {problemTitle}
                  </Description>
                  <p className="text-sm text-gray-600">
                    {t("Upload a ZIP in the problem export format containing exactly one problem. It will replace this problem's title, statement, samples, limits, judge configuration, test data, and attachments. Files missing from the ZIP will be removed.", "上传只含一道题的导出 ZIP。题目标题、题面、样例、限制、判题配置、测试数据和附件将以此包为准，包中缺少的旧文件会被移除。")}
                  </p>
                  <p className="text-sm text-gray-600">
                    {t("The problem ID, linked contests, and submissions will be kept. Existing submissions will not be rejudged automatically.", "更新会保留题目 ID、比赛关联和提交记录。如需按新数据评测已有提交，请手动重判。")}
                  </p>
                  <div>
                    <label htmlFor={fileInputId} className="mb-2 block text-sm font-medium text-gray-700">
                      {t("Select ZIP File", "选择 ZIP 文件")}
                    </label>
                    <input
                      id={fileInputId}
                      type="file"
                      accept=".zip"
                      required
                      disabled={isUpdating}
                      onChange={handleFileChange}
                      className="block w-full text-sm text-gray-500 file:mr-4 file:rounded file:border-0 file:bg-blue-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-200 disabled:opacity-50"
                    />
                  </div>
                  {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
                </div>

                <div className="flex justify-end gap-3 bg-gray-50 px-6 py-4">
                  <button
                    type="button"
                    onClick={closeDialog}
                    disabled={isUpdating}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-200 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {t("Cancel", "取消")}
                  </button>
                  <button
                    type="submit"
                    disabled={isUpdating || !file}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {isUpdating ? t("Updating...", "正在更新…") : t("Update Problem", "更新题目")}
                  </button>
                </div>
              </form>
            </DialogPanel>
          </div>
        </div>
      </Dialog>
    </>
  );
}
