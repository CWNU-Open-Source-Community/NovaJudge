"use client";

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
      setError("Please select a ZIP file containing exactly one problem.");
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

      toast.success(`Successfully updated problem #${problemId}`);
      setIsOpen(false);
      setFile(null);

      try {
        await onUpdated();
      } catch {
        toast.error("Problem updated, but the list could not be refreshed. Please reload the page.");
      }
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Update failed. Please try again.",
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
        className="text-indigo-600 hover:text-indigo-800 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        title="Update Problem"
        aria-label={`Update problem #${problemId}`}
      >
        <ArrowUpTrayIcon className="w-5 h-5" aria-hidden="true" />
      </button>

      <Dialog open={isOpen} onClose={closeDialog} className="relative z-50">
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" />
        <div className="fixed inset-0 overflow-y-auto p-4">
          <div className="flex min-h-full items-center justify-center">
            <DialogPanel className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-6 py-4">
                <DialogTitle className="font-bold text-gray-800">Update Problem</DialogTitle>
                <button
                  type="button"
                  onClick={closeDialog}
                  disabled={isUpdating}
                  aria-label="Close update dialog"
                  className="text-gray-400 hover:text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <XMarkIcon className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>

              <form onSubmit={handleUpdate} aria-busy={isUpdating}>
                <div className="space-y-4 p-6">
                  <Description className="break-words text-sm font-medium text-gray-900">
                    Updating #{problemId}: {problemTitle}
                  </Description>
                  <p className="text-sm text-gray-600">
                    Upload a ZIP in the problem export format containing exactly one problem.
                    It will replace this problem&apos;s title, statement, samples, limits, judge
                    configuration, test data, and attachments. Files missing from the ZIP will
                    be removed.
                  </p>
                  <p className="text-sm text-gray-600">
                    The problem ID, linked contests, and submissions will be kept.
                    Existing submissions will not be rejudged automatically.
                  </p>
                  <div>
                    <label htmlFor={fileInputId} className="mb-2 block text-sm font-medium text-gray-700">
                      Select ZIP File
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
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isUpdating || !file}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {isUpdating ? "Updating..." : "Update Problem"}
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
