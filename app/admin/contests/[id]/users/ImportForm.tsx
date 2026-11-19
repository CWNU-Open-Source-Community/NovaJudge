"use client";

import { useAdminLocale } from "@/components/admin/useAdminLocale";

import { useState } from "react";
import { importUsers } from "./actions";
import { ArrowDownTrayIcon, TableCellsIcon } from "@heroicons/react/24/outline";
import { toast } from "sonner";
import ConfirmModal from "@/components/admin/ConfirmModal";

interface ImportFormProps {
  contestId: number;
  type: "TEAM" | "STAFF";
}

interface PreviewRow {
  username: string;
  password?: string;
  displayName?: string;
  school?: string;
  members?: string;
  seat?: string;
  autoLoginIp?: string;
  role?: string;
  coach?: string;
  category?: string;
}

export default function ImportForm({ contestId, type }: ImportFormProps) {
  const { t } = useAdminLocale();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  // 解析 Excel 粘贴的数据 (Tab 分隔)
  const handleParse = (input: string) => {
    setText(input);
    const rows = input.trim().split("\n");
    const parsed = rows
      .map((row) => {
        // Excel 复制出来是 \t 分隔
        const cols = row.split("\t").map((c) => c.trim());

        if (type === "TEAM") {
          // 格式: Username | Password | TeamName | School | Members | Seat | Coach | Category
          return {
            username: cols[0],
            password: cols[1],
            displayName: cols[2],
            school: cols[3],
            members: cols[4],
            seat: cols[5],
            coach: cols[6],
            category: cols[7],
            autoLoginIp: cols[8],
          };
        } else {
          // 格式: Username | Password | RealName | Role
          return {
            username: cols[0],
            password: cols[1],
            displayName: cols[2],
            role: cols[3],
          };
        }
      })
      .filter((u) => u.username); // 过滤空行

    setPreview(parsed);
  };

  const handleSubmit = async () => {
    if (preview.length === 0) return;
    setIsConfirmOpen(true);
  };

  const handleConfirmImport = async () => {
    setIsSubmitting(true);
    setIsConfirmOpen(false);
    try {
      await importUsers(contestId, preview, type);
      setText("");
      setPreview([]);
      toast.success(t("Import successful!", "导入成功"));
    } catch (e) {
      toast.error(t("Import failed", "导入失败"), { description: String(e) });
    } finally {
      setIsSubmitting(false);
    }
  };

  // 辅助函数：将类型代码转为文字
  const getCategoryLabel = (cat: string) => {
    if (cat === "0") return "Official";
    if (cat === "1") return "Unofficial (★)";
    if (cat === "2") return "Girls";
    return cat || "-";
  };

  return (
    <div className="space-y-4">
      <ConfirmModal cancelText={t("Cancel", "取消")}
        isOpen={isConfirmOpen}
        title={t("Confirm Import", "确认导入")}
        message={t(`Import ${preview.length} accounts?`, `确认导入 ${preview.length} 个账号？`)}
        confirmText={t("Import", "导入")}
        onConfirm={handleConfirmImport}
        onCancel={() => setIsConfirmOpen(false)}
      />
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
        <p className="font-bold flex items-center gap-2">
          <TableCellsIcon className="w-5 h-5" />
          {t("Excel / CSV Paste Format", "表格粘贴格式")}
        </p>
        <div className="mt-2 font-mono bg-white p-2 rounded border border-blue-100 overflow-x-auto whitespace-nowrap">
          {type === "TEAM" ? (
            <span>
              {t("Username   Password   TeamName   School   Members   Seat   Coach   Type(0/1/2)   AutoLoginIP", "用户名　密码　队名　学校　队员　座位　教练　类型（0/1/2）　自动登录 IP")}
            </span>
          ) : (
            <span>
              {t("Username   Password   RealName   Role(JUDGE/BALLOON/PRINT/ADMIN)", "用户名　密码　姓名　角色（JUDGE/BALLOON/PRINT/ADMIN）")}
            </span>
          )}
        </div>
        <div className="mt-2 text-xs opacity-75 space-y-1">
          <p>{t("* Columns are separated by Tab (default Excel copy format).", "用 Tab 分隔列，可直接从 Excel 复制粘贴。")}</p>
          <p className="font-bold text-blue-900">
            {t("* Leave Password empty to auto-generate.", "密码留空时自动生成。")}
          </p>
          {type === "TEAM" && (
            <p>{t("* Type: 0 = Official, 1 = Star (Unofficial), 2 = Girls Team.", "类型可填 0（正式队）、1（打星队）或 2（女生队）。")}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 输入区 */}
        <div>
          <textarea
            className="w-full h-64 p-3 border border-gray-300 rounded-lg font-mono text-xs focus:ring-2 focus:ring-blue-500 outline-none whitespace-pre"
            placeholder={
              type === "TEAM"
                ? `team001\t123456\tMy Team\tXCPC Univ\tAlice,Bob\tA-101\tProf.Zhang\t0\t192.168.1.101`
                : `admin01\t123456\tJohn Doe\tJUDGE`
            }
            value={text}
            onChange={(e) => handleParse(e.target.value)}
          ></textarea>
        </div>

        {/* 预览区 */}
        <div className="border border-gray-300 rounded-lg overflow-hidden flex flex-col h-64">
          <div className="bg-gray-50 px-4 py-2 border-b font-medium text-xs text-gray-500 flex justify-between items-center">
            <span>{t("Preview (", "预览（")}{preview.length} {t("rows)", "行）")}</span>
            <button
              onClick={handleSubmit}
              disabled={preview.length === 0 || isSubmitting}
              className="bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1 transition-colors font-bold shadow-sm"
            >
              <ArrowDownTrayIcon className="w-4 h-4" />
              {isSubmitting ? t("Importing...", "正在导入…") : t("Import Users", "导入账号")}
            </button>
          </div>
          <div className="flex-1 overflow-auto bg-white">
            <table className="w-full text-xs text-left whitespace-nowrap">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2">{t("User", "用户")}</th>
                  <th className="px-3 py-2">{t("Name", "名称")}</th>
                  {type === "TEAM" ? (
                    <>
                      <th className="px-3 py-2">{t("School", "学校")}</th>
                      <th className="px-3 py-2">{t("Seat", "座位")}</th>
                      <th className="px-3 py-2">{t("Coach", "教练")}</th>
                      <th className="px-3 py-2">{t("Type", "类型")}</th>
                      <th className="px-3 py-2">{t("Auto IP", "自动登录 IP")}</th>
                    </>
                  ) : (
                    <th className="px-3 py-2">{t("Role", "角色")}</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y">
                {preview.map((row, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5 font-mono text-blue-600">
                      {row.username}
                    </td>
                    <td className="px-3 py-1.5">{row.displayName}</td>
                    {type === "TEAM" ? (
                      <>
                        <td className="px-3 py-1.5 text-gray-500">
                          {row.school || "-"}
                        </td>
                        <td className="px-3 py-1.5 text-gray-500">
                          {row.seat || "-"}
                        </td>
                        <td className="px-3 py-1.5 text-gray-500">
                          {row.coach || "-"}
                        </td>
                        <td className="px-3 py-1.5 text-gray-500">
                          {getCategoryLabel(row.category as string)}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-gray-500">
                          {row.autoLoginIp || "-"}
                        </td>
                      </>
                    ) : (
                      <td className="px-3 py-1.5">
                        <span className="bg-gray-100 px-1.5 py-0.5 rounded border">
                          {row.role || "JUDGE"}
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
                {preview.length === 0 && (
                  <tr>
                    <td
                      colSpan={type === "TEAM" ? 7 : 3}
                      className="p-8 text-center text-gray-400"
                    >
                      {t("Paste data to preview", "粘贴数据后查看预览")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
