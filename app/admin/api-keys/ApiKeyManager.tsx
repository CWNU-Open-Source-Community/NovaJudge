"use client";

import { useAdminLocale } from "@/components/admin/useAdminLocale";

import { useState } from "react";
import { createApiKey, deleteApiKey, toggleApiKey } from "./actions";
import { toast } from "sonner";
import {
  KeyIcon,
  PlusIcon,
  TrashIcon,
  ClipboardDocumentIcon,
  PowerIcon,
} from "@heroicons/react/24/outline";
import ConfirmModal from "@/components/admin/ConfirmModal";

interface ApiKey {
  id: string;
  key: string;
  name: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  isEnabled: boolean;
}

export default function ApiKeyManager({
  initialKeys,
}: {
  initialKeys: ApiKey[];
}) {
  const { t, locale } = useAdminLocale();
  const [keys, setKeys] = useState(initialKeys);
  const [isCreating, setIsCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [deletingKeyId, setDeletingKeyId] = useState<string | null>(null);
  const [, setCopied] = useState(false);

  const handleToggle = async (id: string, currentStatus: boolean) => {
    try {
      await toggleApiKey(id, !currentStatus);
      setKeys((prev) =>
        prev.map((k) =>
          k.id === id ? { ...k, isEnabled: !currentStatus } : k,
        ),
      );
      toast.success(t(`API key ${currentStatus ? "disabled" : "enabled"}.`, `API 密钥已${currentStatus ? "停用" : "启用"}。`));
    } catch (error) {
      console.log(error);
      toast.error(t("Failed to update API Key status", "更新密钥状态失败"));
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    try {
      const res = await createApiKey(newKeyName);
      if (res.success) {
        toast.success(t("API Key created successfully", "API 密钥已创建"));
        setNewKeyName("");
        // 简单刷新页面或者手动更新列表 (这里简单起见刷新页面)
        window.location.reload();
      }
    } catch (error) {
      console.log(error);
      toast.error(t("Failed to create API Key", "创建 API 密钥失败"));
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingKeyId) return;
    try {
      await deleteApiKey(deletingKeyId);
      toast.success(t("API Key deleted", "API 密钥已撤销"));
      setKeys((prev) => prev.filter((k) => k.id !== deletingKeyId));
    } catch (error) {
      console.log(error);
      toast.error(t("Failed to delete API Key", "撤销 API 密钥失败"));
    } finally {
      setDeletingKeyId(null);
    }
  };

  const copy = async (text: string) => {
    // 1. 优先尝试使用现代 Clipboard API (仅在 HTTPS 或 localhost 下可用)
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        console.warn("Clipboard API failed, trying fallback...", err);
      }
    }

    // 2. 回退方案：使用传统的 document.execCommand (兼容 HTTP 环境)
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;

      // 确保 textarea 不可见且不影响布局
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      textArea.style.top = "0";
      document.body.appendChild(textArea);

      textArea.focus();
      textArea.select();

      const successful = document.execCommand("copy");
      document.body.removeChild(textArea);

      return successful;
    } catch (err) {
      console.error("Fallback copy failed:", err);
      return false;
    }
  };

  const copyToClipboard = async (text: string) => {
    const success = await copy(text);

    if (success) {
      setCopied(true);
      toast.success(t("Copied to clipboard", "已复制到剪贴板"));

      // 2秒后恢复图标状态
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } else {
      toast.error(t("Failed to copy code", "复制失败"));
    }
  };

  return (
    <div className="space-y-6">
      <ConfirmModal cancelText={t("Cancel", "取消")}
        isOpen={!!deletingKeyId}
        title={t("Revoke API Key", "撤销 API 密钥")}
        message={t("Are you sure you want to revoke this API key? Any applications using it will immediately stop working.", "撤销后，使用该密钥的应用将立即失去访问权限。确认撤销？")}
        confirmText={t("Revoke", "撤销")}
        onConfirm={handleDelete}
        onCancel={() => setDeletingKeyId(null)}
        isDestructive
      />

      {/* Create Form */}
      <div className="admin-card p-4 sm:p-5">
        <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
          <PlusIcon className="w-5 h-5" />
          {t("Generate New Key", "创建密钥")}
        </h3>
        <form onSubmit={handleCreate} className="flex flex-wrap gap-2.5">
          <input
            type="text"
            placeholder={t("Key Name (e.g. My Script)", "密钥名称（如外榜同步）")}
            aria-label={t("Key name", "密钥名称")}
            className="admin-input w-auto flex-1 basis-44"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            required
          />
          <button
            type="submit"
            disabled={isCreating}
            className="admin-button admin-button-primary"
          >
            {isCreating ? t("Generating...", "正在创建…") : t("Generate", "创建")}
          </button>
        </form>
      </div>

      {/* Key List */}
      <div className="admin-card overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
          <KeyIcon className="w-5 h-5 text-gray-500" />
          <h3 className="font-medium text-gray-700">{t("Active API Keys", "密钥列表")}</h3>
        </div>

        {keys.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            {t("No API keys found. Generate one to get started.", "还没有 API 密钥，可以在上方创建。")}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {keys.map((key) => (
              <li
                key={key.id}
                className="flex flex-wrap items-start justify-between gap-3 p-4 transition-colors hover:bg-gray-50 sm:p-5"
              >
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900">
                      {key.name || t("Untitled", "未命名")}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        key.isEnabled
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {key.isEnabled ? t("Active", "正常") : t("Disabled", "已停用")}
                    </span>
                  </div>
                  <div className="flex w-fit max-w-full items-center gap-2 rounded-md bg-gray-100 px-2 py-1 font-mono text-xs text-gray-700">
                    <span className="break-all">{key.key}</span>
                    <button
                      onClick={() => copyToClipboard(key.key)}
                      className="text-gray-400 hover:text-gray-600"
                      title={t("Copy", "复制")}
                      aria-label={t("Copy key", "复制密钥")}
                    >
                      <ClipboardDocumentIcon className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
                    <span>{t("Created:", "创建于：")} {new Date(key.createdAt).toLocaleDateString(locale)}</span>
                    {key.lastUsedAt && (
                      <span>
                        {t("Last used:", "最后使用：")} {new Date(key.lastUsedAt).toLocaleString(locale)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggle(key.id, key.isEnabled)}
                    className={`p-2 rounded-full transition-colors cursor-pointer ${
                      key.isEnabled
                        ? "text-green-600 hover:bg-green-50"
                        : "text-gray-400 hover:bg-gray-50"
                    }`}
                    title={key.isEnabled ? t("Disable Key", "停用密钥") : t("Enable Key", "启用密钥")}
                  >
                    <PowerIcon className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setDeletingKeyId(key.id)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors cursor-pointer"
                    title={t("Revoke Key", "撤销密钥")}
                  >
                    <TrashIcon className="w-5 h-5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
