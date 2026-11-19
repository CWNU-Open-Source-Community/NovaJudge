"use client";

import { useAdminLocale } from "@/components/admin/useAdminLocale";

import { useState, useRef } from "react";
import Image from "next/image";
import {
  uploadAsset,
  deleteAsset,
  getAssets,
} from "@/app/admin/problems/[id]/assets/actions";
import {
  TrashIcon,
  PaperClipIcon,
  PhotoIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
// 引入 sonner
import { toast } from "sonner";

interface Asset {
  name: string;
  url: string;
  isImage: boolean;
}

export default function AssetManager({
  problemId,
  initialAssets,
}: {
  problemId: number;
  initialAssets: Asset[];
}) {
  const { t } = useAdminLocale();
  const [assets, setAssets] = useState<Asset[]>(initialAssets);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- 已删除手动维护的 Toast 状态 ---

  const refreshAssets = async () => {
    const newAssets = await getAssets(problemId);
    setAssets(newAssets);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    setUploading(true);

    // 创建 loading toast，并获取 ID
    const toastId = toast.loading(t("Uploading…", "正在上传..."));

    try {
      const formData = new FormData();
      formData.append("file", e.target.files[0]);

      await uploadAsset(problemId, formData);
      await refreshAssets();

      if (fileInputRef.current) fileInputRef.current.value = "";

      // 更新 toast 为成功状态
      toast.success(t("Upload complete", "上传成功！"), { id: toastId });
    } catch (error) {
      console.log(error);
      // 更新 toast 为错误状态
      toast.error(t("Upload failed. Please retry.", "上传失败，请重试"), { id: toastId });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = (filename: string) => {
    // 使用 sonner 的 action 模式来替代原生 confirm
    toast(`确定要删除 ${filename} 吗?`, {
      description: "此操作无法撤销，文件将被永久删除。",
      action: {
        label: "确定删除",
        onClick: async () => {
          const toastId = toast.loading(t("Deleting…", "正在删除..."));
          try {
            await deleteAsset(problemId, filename);
            setAssets((prev) => prev.filter((a) => a.name !== filename));
            toast.success(t("File deleted", "文件已删除"), { id: toastId });
          } catch (e) {
            console.log(e);
            toast.error(t("Delete failed", "删除失败"), { id: toastId });
          }
        },
      },
      cancel: {
        label: "取消",
        onClick: () => {},
      },
      duration: 2000,
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(t("Markdown link copied", "Markdown 链接已复制"));
  };

  return (
    <div className="mt-4 border p-4 rounded-md bg-gray-50 h-[calc(100%-2rem)] flex flex-col relative text-sm">
      <h3 className="font-bold text-gray-700 mb-4 flex items-center justify-between">
        <span className="flex items-center gap-2">
          {t("Attachments and images", "附件与图片")}
          <button
            onClick={refreshAssets}
            title={t("Refresh files", "刷新列表")}
            className="text-gray-400 cursor-pointer hover:text-blue-600"
          >
            <ArrowPathIcon className="w-4 h-4" />
          </button>
        </span>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50 transition-colors cursor-pointer"
          disabled={uploading}
        >
          {uploading ? t("Uploading…", "上传中...") : t("Upload file", "上传文件")}
        </button>
      </h3>

      <input type="file" hidden ref={fileInputRef} onChange={handleUpload} />

      <div className="flex-1 overflow-y-auto min-h-50 space-y-2 pr-1">
        {assets.map((asset) => (
          <div
            key={asset.name}
            className="flex items-center gap-3 bg-white p-2.5 text-xs border border-gray-200 rounded shadow-sm hover:border-blue-300 transition-colors group"
          >
            {asset.isImage ? (
              <div className="w-8 h-8 shrink-0 bg-gray-100 rounded flex items-center justify-center overflow-hidden relative">
                <Image
                  src={asset.url}
                  alt={asset.name}
                  fill
                  className="object-cover"
                  unoptimized
                />
              </div>
            ) : (
              <div className="w-8 h-8 shrink-0 bg-gray-100 rounded flex items-center justify-center">
                <PaperClipIcon className="w-4 h-4 text-gray-500" />
              </div>
            )}

            <div className="flex-1 min-w-0">
              <div
                className="truncate font-medium text-gray-700"
                title={asset.name}
              >
                {asset.name}
              </div>
              <div className="text-[10px] text-gray-400 truncate select-all">
                {asset.url}
              </div>
            </div>

            <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() =>
                  copyToClipboard(
                    asset.isImage
                      ? `![${asset.name}](${asset.url})`
                      : `[${asset.name}](${asset.url})`,
                  )
                }
                className="text-blue-600 hover:text-blue-800 text-[10px] cursor-pointer font-bold px-1"
              >
                {t("Copy", "复制")}
              </button>

              <button
                onClick={() => handleDelete(asset.name)}
                className="text-red-400 cursor-pointer hover:text-red-600 px-1"
              >
                <TrashIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
        {assets.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 text-xs py-10 border-2 border-dashed border-gray-200 rounded">
            <PhotoIcon className="w-8 h-8 mb-2 opacity-50" />
            <p>{t("No files yet. Use Upload to add one.", "暂无文件，点击右上角上传")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
