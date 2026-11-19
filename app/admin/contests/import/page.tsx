'use client';

import { AdminPageHeader } from "@/components/admin/AdminPage";
import { useAdminLocale } from "@/components/admin/useAdminLocale";

import { useState } from "react";
import { PlayIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { toast } from "sonner";

export default function AdminContestsImportPage() {
  const { t } = useAdminLocale();
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState('native');
  const [result, setResult] = useState<{
    importedContests: string[];
    importedProblems?: { id: number; title: string; displayId?: string }[];
    errors: string[];
    warnings?: string[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setResult(null);
      if (selectedFile.name.toLowerCase().endsWith(".zip")) {
        setFile(selectedFile);
      } else {
        setFile(null);
        toast.error(t("Please upload a ZIP file", "请上传 ZIP 文件"));
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      toast.error(t("Please select a ZIP file to upload", "请选择要上传的 ZIP 文件"));
      return;
    }

    setIsLoading(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("format", format);

      const response = await fetch('/api/contests/import', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Import failed');
      }

      const result = await response.json();
      setResult(result);
      if (result.importedProblems?.length) toast.success(t(`Imported ${result.importedProblems.length} problems.`, `已将 ${result.importedProblems.length} 道题导入题库。`));
      if (result.importedContests.length) toast.success(t(`Imported ${result.importedContests.length} contests.`, `已导入 ${result.importedContests.length} 场比赛。`));
      if (result.errors?.length) toast.error(t(`Import finished with ${result.errors.length} errors. See details below.`, `导入结束，发现 ${result.errors.length} 个错误。请查看下方详情。`));
    } catch (error) {
      toast.error((error as Error).message || t("Import failed. Please try again.", "导入失败，请重试。"));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader title={format === "polygon" ? t("Import Polygon Contest Problems", "导入 Polygon 比赛题目") : t("Import Contests", "导入比赛")} back={{ href: "/admin/contests", label: t("Back to Contests", "返回比赛管理") }} />

      <div className="admin-card p-4 sm:p-6">
        <div className="mx-auto max-w-2xl">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-700 mb-2">{format === 'polygon' ? t("Upload Polygon Contest Package", "上传 Polygon 比赛题包") : t("Upload Contest Data", "上传比赛数据")}</h2>
            <p className="text-gray-500 text-sm">
              {format === 'polygon'
                ? t("Import all problems from a Polygon contest export into the problem bank. Administrators create contests and select their problems separately.", "将 Polygon 比赛包中的题目导入题库，再创建比赛并添加题目。")
                : t("Upload a NovaJudge export ZIP containing contest information, users, problems, and submissions.", "上传 NovaJudge 导出的 ZIP，以导入比赛信息、账号、题目和提交记录。")}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="import-format" className="block text-sm font-medium text-gray-700 mb-2">{t("Import Format", "导入格式")}</label>
              <select id="import-format" value={format} disabled={isLoading}
                onChange={(event) => { setFormat(event.target.value); setResult(null); }}
                className="w-full rounded-md border border-gray-300 px-3 py-2">
                <option value="native">NovaJudge ZIP</option>
                <option value="polygon">{t("Polygon Contest ZIP (problems only)", "Polygon 比赛 ZIP（导入题目）")}</option>
              </select>
            </div>
            {format === 'polygon' && (
              <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 space-y-2">
                <p>{t("Upload the ZIP exported from your Polygon contest, including", "上传从 Polygon 导出的比赛 ZIP，其中应包含")} <code>contest.xml</code> {t("and its complete problem directories or ZIPs. All listed problems are imported together, in package order.", "和完整的题目目录或 ZIP。平台按照题包顺序批量导入题目。")}</p>
                <p>{t("Supports ordinary, interactive, and two-run communication problems. Include all generated tests, answers, and the C++ checker/interactor sources.", "支持普通题、交互题和两轮通信题。请包含已生成的测试数据、答案以及 C++ checker 和 interactor 源码。")}</p>
                <p>{t("Packages without", "未包含")} <code>contest.xml</code> {t("are imported in filename order. Use Linux or Windows packages with generated tests, answers, and C++ testlib checkers.", "的题包按文件名排序导入。请使用含完整测试数据、答案和 C++ testlib checker 的 Linux 或 Windows 包。")}</p>
                <p>{t("This upload adds problems to the problem bank. After import, create a contest in the admin panel and add the imported problems.", "导入后，题目会加入题库。请在后台创建比赛并关联这些题目。")}</p>
              </div>
            )}
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-500 transition-colors">
              <PlayIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700">{t("Select a ZIP file to import", "选择要导入的 ZIP 文件")}</p>
                <label className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 cursor-pointer">
                  {t("Browse files", "浏览文件")}
                  <input
                    type="file"
                    className="sr-only"
                    accept=".zip,application/zip"
                    onChange={handleFileChange}
                    disabled={isLoading}
                  />
                </label>
              </div>
            </div>

            {file && (
              <div className="bg-gray-50 p-3 rounded-md">
                <p className="text-sm text-gray-700">{t("Selected file:", "已选文件：")} {file.name}</p>
                <p className="text-xs text-gray-500">{t("Size:", "大小：")} {(file.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isLoading || !file}
                className="flex items-center gap-2 bg-purple-600 text-white px-6 py-2 rounded hover:bg-purple-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {t("Importing...", "正在导入…")}
                  </>
                ) : (
                  format === 'polygon' ? t("Import Problems", "导入题目") : t("Import Contests", "导入比赛")
                )}
              </button>
            </div>
          </form>
          {result && (
            <div className="mt-6 space-y-4" aria-live="polite">
              <h3 className="font-semibold text-gray-800">{t("Import Result", "导入结果")}</h3>
              {result.importedContests.length > 0 && (
                <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                  <p>{t("Successfully imported", "已成功导入")} {result.importedContests.length} {t("contests.", "场比赛。")}</p>
                  <ul className="mt-2 space-y-1">{result.importedContests.map((name, index) => <li key={index}>{name}</li>)}</ul>
                </div>
              )}
              {!!result.importedProblems?.length && (
                <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                  <p>{t("Successfully imported", "已成功导入")} {result.importedProblems.length} {t("problems to the problem bank.", "道题目到题库。")}</p>
                  <ul className="mt-2 space-y-1">{result.importedProblems.map((problem) => (
                    <li key={problem.id}>
                      {problem.displayId && <span>{problem.displayId} → </span>}
                      <Link className="underline" href={`/admin/problems/${problem.id}`}>#{problem.id} — {problem.title}</Link>
                    </li>
                  ))}</ul>
                  <div className="mt-3 flex gap-4">
                    <Link className="underline" href="/admin/problems">{t("Open Problem Bank", "打开题库")}</Link>
                    <Link className="underline" href="/admin/contests/create">{t("Create Contest", "创建比赛")}</Link>
                  </div>
                </div>
              )}
              {!!result.errors.length && <ul className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 space-y-1">
                {result.errors.map((error, index) => <li key={index}>{error}</li>)}
              </ul>}
              {!!result.warnings?.length && <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <p className="font-medium mb-2">{t("Review before publishing", "发布前检查")}</p>
                <ul className="space-y-1">{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
              </div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
