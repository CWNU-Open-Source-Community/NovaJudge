"use client";

import { useAdminLocale } from "@/components/admin/useAdminLocale";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { XMarkIcon } from "@heroicons/react/24/outline";

const CodeEditor = dynamic(
  () => import("@uiw/react-textarea-code-editor").then((mod) => mod.default),
  { ssr: false }
);

interface FileModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileName: string;
  initialContent: string;
  onSave: (content: string) => Promise<void>;
}

export default function FileModal({
  isOpen,
  onClose,
  fileName,
  initialContent,
  onSave,
}: FileModalProps) {
  const { t } = useAdminLocale();
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);

  // 当打开新文件时，重置内容
  useEffect(() => {
    setContent(initialContent);
  }, [initialContent]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setSaving(true);
    await onSave(content);
    setSaving(false);
    onClose();
  };

  // 根据文件名推断语言
  const language = fileName.endsWith(".py")
    ? "python"
    : fileName.endsWith(".cpp") || fileName.endsWith(".cc")
    ? "cpp"
    : fileName.endsWith(".c")
    ? "c"
    : fileName.endsWith(".java")
    ? "java"
    : fileName.endsWith(".json")
    ? "json"
    : "plaintext";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl h-[80vh] flex flex-col animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            {t("Editing:", "正在编辑：")}{" "}
            <span className="font-mono text-blue-600 bg-blue-50 px-2 py-0.5 rounded text-base">
              {fileName}
            </span>
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        {/* Editor Content */}
        <div className="flex-1 overflow-auto bg-[#f5f5f5] p-0 relative">
          <CodeEditor
            value={content}
            language={language}
            placeholder={t("Please enter code.", "请输入文件内容。")}
            onChange={(evn) => setContent(evn.target.value)}
            padding={20}
            style={{
              fontSize: 14,
              backgroundColor: "#f5f5f5",
              fontFamily:
                "ui-monospace,SFMono-Regular,SF Mono,Consolas,Liberation Mono,Menlo,monospace",
              minHeight: "100%",
            }}
          />
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3 rounded-b-lg">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
          >
            {t("Cancel", "取消")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? t("Saving...", "正在保存…") : t("Save Changes", "保存修改")}
          </button>
        </div>
      </div>
    </div>
  );
}
