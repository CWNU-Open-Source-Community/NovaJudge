"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import YamlEditor from "@/components/admin/YamlEditor";
import FileModal from "@/components/admin/FileModal";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  DocumentIcon,
  TrashIcon,
  CloudArrowUpIcon,
  ArrowPathIcon,
  PencilSquareIcon,
} from "@heroicons/react/24/outline";
import {
  uploadFiles,
  deleteFile,
  saveYamlConfig,
  getFileContent,
  saveFileContent,
} from "./actions";
import ConfirmModal from "@/components/admin/ConfirmModal";

// 辅助函数：格式化大小
const formatSize = (bytes: number) => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (
    parseFloat((bytes / Math.pow(k, i)).toFixed(2)) +
    " " +
    ["B", "KB", "MB", "GB"][i]
  );
};

interface FileStat {
  name: string;
  size: number;
}

interface PageProps {
  problemId: number;
  problemType: string;
  initialFiles: FileStat[];
  initialYaml: string;
}

export default function DataManagementClient({
  problemId,
  problemType,
  initialFiles,
  initialYaml,
}: PageProps) {
  const router = useRouter(); // 2. 初始化 router
  const isCommunication = problemType === "communication";

  // 本地状态
  const [files, setFiles] = useState<FileStat[]>(initialFiles);
  const [yamlContent, setYamlContent] = useState(initialYaml);
  const [isUploading, setIsUploading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<{
    name: string;
    content: string;
  } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    setFiles(initialFiles);
  }, [initialFiles]);

  // 【新增】打开文件处理
  const handleOpenFile = async (fileName: string) => {
    try {
      const content = await getFileContent(problemId, fileName);
      setActiveFile({ name: fileName, content });
      setIsModalOpen(true);
    } catch (e) {
      console.log(e);
      toast.error("Failed to load file content.");
    }
  };

  // 【新增】保存文件内容
  const handleSaveFileContent = async (newContent: string) => {
    if (!activeFile) return;
    try {
      await saveFileContent(problemId, activeFile.name, newContent);
      toast.success("File saved successfully!");
      router.refresh(); // 刷新数据
    } catch (e) {
      console.log(e);
      toast.error("Failed to save file.");
    }
  };

  // 处理上传
  const handleUpload = async (formData: FormData) => {
    setIsUploading(true);
    try {
      // Server Action 返回新的 YAML
      const newYaml = await uploadFiles(problemId, formData);

      // 更新 YAML 编辑器
      if (newYaml) {
        setYamlContent(newYaml);
      }
      router.refresh();

      formRef.current?.reset();
    } catch (error) {
      console.error("Upload failed", error);
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  // 处理删除
  const handleDelete = (fileName: string) => {
    setFileToDelete(fileName);
    setIsConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (!fileToDelete) return;

    setIsConfirmOpen(false);

    // 乐观更新：先在界面上删掉，让用户感觉很快
    setFiles((prev) => prev.filter((f) => f.name !== fileToDelete));

    try {
      // 后台真实删除
      await deleteFile(problemId, fileToDelete);
      toast.success("File deleted successfully");
    } catch (e) {
      console.error(e);
      toast.error("Failed to delete file");
      // 如果失败，应该重新加载文件列表以保持一致
      router.refresh();
    } finally {
      setFileToDelete(null);
    }
  };

  // 处理保存 YAML
  const handleSaveYaml = async (content: string) => {
    try {
      const savedYaml = await saveYamlConfig(problemId, content);
      setYamlContent(savedYaml);
      toast.success("Configuration saved!");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save configuration",
      );
    }
  };

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      <ConfirmModal
        isOpen={isConfirmOpen}
        title="Delete File"
        message={`Are you sure you want to delete ${fileToDelete}?`}
        confirmText="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setIsConfirmOpen(false)}
        isDestructive
      />
      {/* 【插入弹窗组件】 */}
      <FileModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        fileName={activeFile?.name || ""}
        initialContent={activeFile?.content || ""}
        onSave={handleSaveFileContent}
      />
      {/* 顶部导航 */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-4">
          <Link
            href="/admin/problems"
            className="flex items-center text-gray-500 hover:text-gray-700"
          >
            <ArrowLeftIcon className="w-5 h-5 mr-1" /> Back
          </Link>
          <h1 className="text-xl font-bold text-gray-800">
            Data Management{" "}
            <span className="text-gray-400 font-mono text-base">
              #{problemId}
            </span>
          </h1>
        </div>
      </div>

      {isCommunication && (
        <details open className="mb-4 shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <summary className="cursor-pointer font-semibold">
            Communication (Run twice) — Configuration
          </summary>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <p>
                Upload <code>communicator.cpp</code> (C++ / testlib) and test
                inputs (<code>*.in</code>). The communicator prepares the
                second-run input, checks the allowed message, and judges the
                result. The server provides <code>testlib.h</code>.
              </p>
              <p>
                Reference answers (<code>*.out</code> or <code>*.ans</code>) are
                optional; use <code>/dev/null</code> when none is needed.
                Include the complete first-run input in each test case.
              </p>
              <p>
                Each run has its own time and memory limits and shares no
                memory or files with the other run. <code>output_limit</code>
                sets the output size limit in bytes; the communicator enforces
                the problem-specific message restrictions.
              </p>
            </div>
            <div>
              <p className="mb-2 font-semibold">Example problem.yml</p>
              <pre className="overflow-x-auto rounded border border-blue-100 bg-white p-3 font-mono text-xs">
                {`type: communication
communicator: communicator.cpp
communication:
  output_limit: 1048576
cases:
  - input: 1.in
    output: /dev/null`}
              </pre>
            </div>
          </div>
        </details>
      )}

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0">
        {/* 左侧：YAML 编辑器 */}
        <div className="flex flex-col min-h-0">
          <YamlEditor
            key={yamlContent} // 确保内容变化时重新渲染编辑器
            initialValue={yamlContent}
            onSave={handleSaveYaml}
          />
        </div>

        {/* 右侧：文件列表 */}
        <div className="flex flex-col border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm min-h-0">
          <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
            <h3 className="font-bold text-gray-700 text-sm mb-3">
              Test Data Files
            </h3>
            {isCommunication && (
              <p className="mb-3 text-xs text-gray-500">
                Upload communicator.cpp and all test data together, or as a ZIP.
                Each upload replaces the existing data files.
              </p>
            )}

            <form ref={formRef} action={handleUpload} className="flex gap-2">
              <input
                type="file"
                name="files"
                multiple
                required
                className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
              <button
                type="submit"
                disabled={isUploading}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-full text-xs font-bold flex items-center transition-colors disabled:opacity-50"
              >
                {isUploading ? (
                  <ArrowPathIcon className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <CloudArrowUpIcon className="w-4 h-4 mr-1" />
                )}
                {isUploading ? "Uploading..." : "Upload"}
              </button>
            </form>
          </div>

          <div className="flex-1 overflow-y-auto p-0">
            {files?.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <DocumentIcon className="w-12 h-12 mb-2 opacity-20" />
                <p className="text-sm">No files uploaded yet.</p>
              </div>
            ) : (
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-gray-500 bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-6 py-3">Filename</th>
                    <th className="px-6 py-3 w-48">Size</th>
                    <th className="px-6 py-3 w-24 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {files?.map((file) => (
                    <tr key={file.name} className="hover:bg-gray-50 group">
                      <td className="px-6 py-3 font-mono text-gray-700 flex items-center">
                        <button
                          onClick={() => handleOpenFile(file.name)}
                          className="flex items-center hover:text-blue-600 transition-colors cursor-pointer"
                        >
                          <DocumentIcon className="w-4 h-4 mr-2 text-gray-400" />
                          {file.name}
                        </button>
                      </td>
                      <td className="px-6 py-3 text-gray-500">
                        {formatSize(file.size)}
                      </td>
                      <td className="px-6 py-3 text-center">
                        {/* 编辑按钮 */}
                        <button
                          onClick={() => handleOpenFile(file.name)}
                          className="text-blue-400 hover:text-blue-600 p-1 rounded hover:bg-blue-50 transition-colors cursor-pointer"
                          title="View/Edit"
                        >
                          <PencilSquareIcon className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(file.name)}
                          className="text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50 transition-colors cursor-pointer"
                          title="Delete"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
