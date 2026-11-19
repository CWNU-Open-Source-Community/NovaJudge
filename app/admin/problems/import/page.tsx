'use client';

import { AdminPageHeader } from "@/components/admin/AdminPage";
import { useAdminLocale } from "@/components/admin/useAdminLocale";

import { useState } from "react";
import {
  PlayIcon,
} from "@heroicons/react/24/outline";
import { toast } from "sonner";

export default function ImportProblemsPage() {
  const { t } = useAdminLocale();
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState('native');
  const [isLoading, setIsLoading] = useState(false);
  const [importResult, setImportResult] = useState<{
    success: boolean;
    importedProblems: { id: number; title: string; displayId?: string }[];
    errors: string[];
    warnings?: string[];
  } | null>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0];
    if (selectedFile && selectedFile.name.toLowerCase().endsWith('.zip')) {
      setFile(selectedFile);
      setImportResult(null);
    } else {
      toast.error(t("Please select a ZIP file", "请选择 ZIP 文件"));
      setFile(null);
    }
  }

  async function handleImport() {
    if (!file) {
      toast.error(t("Please select a file to import", "请选择要导入的文件"));
      return;
    }

    setIsLoading(true);
    setImportResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('format', format);

      const response = await fetch('/api/problems/import', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'Import failed');
      }

      const result = await response.json();
      setImportResult(result);

      if (result.importedProblems.length > 0) {
        toast.success(t(`Imported ${result.importedProblems.length} problems.`, `已导入 ${result.importedProblems.length} 道题。`));
      }

      if (result.errors.length > 0) {
        result.errors.forEach((error: string) => {
          toast.error(error);
        });
      }

    } catch (error) {
      toast.error((error as Error).message || t("Import failed. Please try again.", "导入失败，请重试。"));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader title={t("Import Problems", "导入题目")} back={{ href: "/admin/problems", label: t("Back to Problem Bank", "返回题库") }} />

      <div className="admin-card max-w-3xl p-4 sm:p-6">
        <div className="space-y-6">
          <div>
            <label htmlFor="import-format" className="block text-sm font-medium text-gray-700 mb-2">{t("Import Format", "导入格式")}</label>
            <select id="import-format" value={format} disabled={isLoading}
              onChange={(event) => { setFormat(event.target.value); setImportResult(null); }}
              className="w-full rounded-md border border-gray-300 px-3 py-2">
              <option value="native">NovaJudge ZIP</option>
              <option value="polygon">{t("Polygon ZIP (Linux / Windows)", "Polygon ZIP（Linux / Windows）")}</option>
            </select>
          </div>
          {/* File Upload Section */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t("Select ZIP File", "选择 ZIP 文件")}
            </label>
            <div className="flex items-center gap-4">
              <input
                type="file"
                accept=".zip"
                onChange={handleFileChange}
                disabled={isLoading}
                className="block w-full text-sm text-gray-500
                  file:mr-4 file:py-2 file:px-4
                  file:rounded file:border-0
                  file:text-sm file:font-medium
                  file:bg-blue-100 file:text-blue-700
                  hover:file:bg-blue-200"
              />
            </div>
            {file && (
              <p className="mt-2 text-sm text-gray-500">
                {t("Selected file:", "已选文件：")} {file.name}
              </p>
            )}
          </div>

          {/* Import Button */}
          <div>
            <button
              onClick={handleImport}
              disabled={isLoading || !file}
              className="w-full bg-purple-600 text-white px-6 py-3 rounded shadow hover:bg-purple-700 transition flex items-center justify-center gap-2 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {t("Importing...", "正在导入…")}
                </>
              ) : (
                <>
                  <PlayIcon className="w-5 h-5" />
                  {t("Import Problems", "导入题目")}
                </>
              )}
            </button>
          </div>

          {/* Import Result */}
          {importResult && (
            <div className="mt-8 border-t pt-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">{t("Import Result", "导入结果")}</h2>
              
              {importResult.importedProblems.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-medium text-green-700 mb-2">
                    {t("Successfully Imported (", "已成功导入（")}{importResult.importedProblems.length} {t("problems)", "道题）")}
                  </h3>
                  <ul className="bg-green-50 border border-green-200 rounded-md p-4 space-y-2">
                    {importResult.importedProblems.map((problem) => (
                      <li key={problem.id} className="text-sm text-green-800">
                        {problem.displayId && `${problem.displayId} → `}#{problem.id} - {problem.title}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {importResult.errors.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-red-700 mb-2">
                    {t("Errors (", "错误（")}{importResult.errors.length})
                  </h3>
                  <ul className="bg-red-50 border border-red-200 rounded-md p-4 space-y-2">
                    {importResult.errors.map((error, index) => (
                      <li key={index} className="text-sm text-red-800">
                        {error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!!importResult.warnings?.length && (
                <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  <h3 className="font-medium mb-2">{t("Review before publishing", "发布前检查")}</h3>
                  <ul className="list-disc pl-5 space-y-1">{importResult.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
                </div>
              )}
            </div>
          )}

          {/* Instructions */}
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">{t("Instructions", "导入说明")}</h2>
            <div className="bg-gray-50 border border-gray-200 rounded-md p-4">
              {format === 'polygon' ? (
                <ul className="text-sm text-gray-600 space-y-2 list-disc pl-5">
                  <li>{t("Upload a Polygon Linux or Windows package containing", "上传 Polygon Linux 或 Windows 题包，包含")} <code>problem.xml</code>{t(", generated tests, answers, and C++ checker source.", "、已生成的测试数据、参考答案和 C++ checker 源码。")}</li>
                  <li>{t("A single problem ZIP, a Polygon contest export, multiple problem directories, or an outer ZIP containing problem ZIPs is supported.", "支持单题 ZIP、Polygon 比赛包、多题目录和包含多个题目 ZIP 的外层压缩包。")}</li>
                  <li>{t("Contest exports import their problems into the problem bank. Administrators create contests and add the imported problems separately.", "导入的题目会进入题库，请在后台创建比赛并关联题目。")}</li>
                  <li>{t("Imports the title, limits, examples, HTML statement, images, tests, and testlib checker. Chinese statements are preferred, then English.", "导入标题、限制、样例、HTML 题面、图片、测试数据和 testlib checker。优先使用中文题面，其次为英文题面。")}</li>
                  <li>{t("Statement sections become separate editable Blocks, including Problem Description, Input, Output, Interaction, and Note.", "题目描述、输入、输出、交互和说明将拆分为可编辑章节。")}</li>
                  <li>{t("PDF or LaTeX-only statements are imported as attachments. Review any warnings after import.", "PDF 或仅有 LaTeX 的题面会作为附件导入。导入后请查看提示。")}</li>
                  <li>{t("Interactive and two-run communication problems are supported, including interaction in either the first run or both runs. Include the C++ interactor source when used.", "支持交互题和两轮通信题。第一轮或两轮均可交互，请随包提供 C++ interactor 源码。")}</li>
                  <li>{t("File I/O and partial-score packages require manual conversion. Incomplete standard packages are rejected.", "文件输入输出题和部分分题需手动转换。导入前请确认测试数据完整。")}</li>
                </ul>
              ) : <ul className="text-sm text-gray-600 space-y-2 list-disc pl-5">
                <li>{t("Create a ZIP file containing one or more problem directories", "将一个或多个题目目录压缩为 ZIP")}</li>
                <li>{t("Each problem directory should contain:", "每个题目目录包含以下内容")}</li>
                <ul className="pl-5 mt-1 space-y-1">
                  <li><code>problem.json</code> {t("- Problem metadata", "题目基本信息")}</li>
                  <li><code>data/</code> {t("- Test cases and judge configuration", "测试数据与判题配置")}</li>
                  <li><code>assets/</code> {t("- Problem attachments", "题目附件")}</li>
                </ul>
                <li>{t("The ZIP file structure should match the export format", "ZIP 目录结构应符合本平台的导出格式")}</li>
              </ul>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
