"use client";

import { useAdminLocale } from "@/components/admin/useAdminLocale";

import { useState } from "react";
import { deleteUser, deleteUsers } from "./actions";
import EditUserModal from "./EditUserModal";
import ConfirmModal from "@/components/admin/ConfirmModal";
import {
  TrashIcon,
  PencilSquareIcon,
  ArrowDownTrayIcon,
  EyeIcon,
  EyeSlashIcon,
} from "@heroicons/react/24/outline";
import { User } from "@/lib/generated/prisma/client";
import { toast } from "sonner";

// 辅助组件：显示队伍类型
function TeamCategoryBadge({ category }: { category: string | null }) {
  const { t } = useAdminLocale();
  if (category === "1")
    return (
      <span className="bg-purple-100 text-purple-700 border border-purple-200 px-2 py-0.5 rounded text-[10px] font-bold">
        {t("★ Star", "★ 打星队")}
      </span>
    );
  if (category === "2")
    return (
      <span className="bg-pink-100 text-pink-700 border border-pink-200 px-2 py-0.5 rounded text-[10px] font-bold">
        {t("Girls", "女生队")}
      </span>
    );
  return (
    <span className="bg-gray-100 text-gray-600 border border-gray-200 px-2 py-0.5 rounded text-[10px]">
      {t("Official", "正式队")}
    </span>
  );
}

export default function ClientUserTable({
  initialUsers,
  contestId,
  activeTab,
}: {
  initialUsers: User[];
  contestId: number;
  activeTab: "TEAM" | "STAFF";
}) {
  const { t } = useAdminLocale();
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showPasswords, setShowPasswords] = useState(false); // 控制是否显示密码
  const [deletingUser, setDeletingUser] = useState<User | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(
    new Set(),
  );
  const [isBulkDeleteConfirmOpen, setIsBulkDeleteConfirmOpen] = useState(false);

  // 批量删除
  const handleBulkDelete = async () => {
    setIsBulkDeleteConfirmOpen(false);
    try {
      await deleteUsers(Array.from(selectedUserIds), contestId);
      setSelectedUserIds(new Set());
      toast.success(t(`Deleted ${selectedUserIds.size} users.`, `已删除 ${selectedUserIds.size} 个账号。`));
    } catch (error) {
      toast.error(t("Failed to delete users", "批量删除账号失败"), { description: String(error) });
    }
  };

  // 全选/取消全选
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedUserIds(new Set(initialUsers.map((u) => u.id)));
    } else {
      setSelectedUserIds(new Set());
    }
  };

  // 单选/取消单选
  const handleSelectUser = (userId: string, checked: boolean) => {
    const newSelected = new Set(selectedUserIds);
    if (checked) {
      newSelected.add(userId);
    } else {
      newSelected.delete(userId);
    }
    setSelectedUserIds(newSelected);
  };

  // 删除用户操作
  const handleDelete = async () => {
    if (!deletingUser) return;
    try {
      await deleteUser(deletingUser.id, contestId);
      setDeletingUser(null);
      toast.success(t("User deleted successfully!", "账号已删除"));
    } catch (error) {
      toast.error(t("Failed to delete user", "删除账号失败"), { description: String(error) });
    }
  };

  // 导出 CSV 功能
  const handleExport = () => {
    const headers =
      activeTab === "TEAM"
        ? [
            "Username",
            "Password",
            "DisplayName",
            "School",
            "Members",
            "Seat",
            "Coach",
            "Category",
            "AutoLoginIP",
          ]
        : ["Username", "Password", "DisplayName", "Role"];

    // 生成 CSV 内容 (直接使用 u.plainPassword)
    const csvContent = [
      headers.join(","),
      ...initialUsers.map((u: User) => {
        const pass = u.plainPassword || "********"; // 如果是旧数据没有明文，显示星号
        const row =
          activeTab === "TEAM"
            ? [
                u.username,
                pass,
                u.displayName,
                u.school,
                u.members,
                u.seat,
                u.coach,
                u.category,
                u.autoLoginIp,
              ]
            : [u.username, pass, u.displayName, u.role];
        return row
          .map(
            (cell: string | null) =>
              `"${(cell || "").toString().replace(/"/g, '""')}"`,
          )
          .join(",");
      }),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `contest_${contestId}_${activeTab.toLowerCase()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="admin-card overflow-hidden">
      <ConfirmModal cancelText={t("Cancel", "取消")}
        isOpen={!!deletingUser}
        title={t("Delete User", "删除账号")}
        message={t(`Delete user ${deletingUser?.username}?`, `确认删除账号 ${deletingUser?.username}？`)}
        confirmText={t("Delete", "删除")}
        onConfirm={handleDelete}
        onCancel={() => setDeletingUser(null)}
        isDestructive
      />
      <ConfirmModal cancelText={t("Cancel", "取消")}
        isOpen={isBulkDeleteConfirmOpen}
        title={t("Delete Users", "批量删除账号")}
        message={t(`Permanently delete ${selectedUserIds.size} selected users?`, `确认永久删除选中的 ${selectedUserIds.size} 个账号？`)}
        confirmText={t("Delete Selected", "删除选中项")}
        onConfirm={handleBulkDelete}
        onCancel={() => setIsBulkDeleteConfirmOpen(false)}
        isDestructive
      />
      <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <h3 className="font-bold text-gray-700">{t("User List", "账号列表")}</h3>
          <span className="text-xs text-gray-500 bg-white border px-2 py-1 rounded">
            {t("Total:", "总计：")} {initialUsers.length}
          </span>
          {selectedUserIds.size > 0 && (
            <span className="text-xs text-blue-600 bg-blue-50 border border-blue-200 px-2 py-1 rounded font-medium">
              {t("Selected:", "已选：")} {selectedUserIds.size}
            </span>
          )}
        </div>

        <div className="flex gap-2">
          {selectedUserIds.size > 0 && (
            <button
              onClick={() => setIsBulkDeleteConfirmOpen(true)}
              className="flex items-center gap-1 text-sm font-medium text-red-700 bg-red-50 border border-red-200 px-3 py-1.5 rounded hover:bg-red-100 transition-colors cursor-pointer"
            >
              <TrashIcon className="w-4 h-4" />
              {t("Delete Selected", "删除选中项")}
            </button>
          )}

          {/* 切换密码显示按钮 */}
          <button
            onClick={() => setShowPasswords(!showPasswords)}
            className="flex items-center cursor-pointer gap-1 text-sm font-medium text-gray-600 bg-white border border-gray-300 px-3 py-1.5 rounded hover:bg-gray-50 transition-colors"
          >
            {showPasswords ? (
              <EyeSlashIcon className="w-4 h-4" />
            ) : (
              <EyeIcon className="w-4 h-4" />
            )}
            {showPasswords ? t("Hide", "隐藏") : t("Show Passwords", "显示密码")}
          </button>

          {/* 导出按钮 */}
          <button
            onClick={handleExport}
            className="flex items-center gap-1 text-sm font-medium text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded hover:bg-green-100 transition-colors cursor-pointer"
          >
            <ArrowDownTrayIcon className="w-4 h-4" />
            {t("Export CSV", "导出 CSV")}
          </button>
        </div>
      </div>

      <div className="admin-table-scroll" role="region" tabIndex={0} aria-label={t("Contest accounts", "比赛账号列表")}>
        <table className="w-full text-sm text-left whitespace-nowrap">
          <thead className="bg-gray-50 text-gray-600 font-medium border-b uppercase text-xs">
            <tr>
              <th className="px-6 py-3 w-4">
                <input
                  type="checkbox"
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  checked={
                    initialUsers.length > 0 &&
                    selectedUserIds.size === initialUsers.length
                  }
                  onChange={(e) => handleSelectAll(e.target.checked)}
                />
              </th>
              <th className="px-6 py-3">{t("Username", "用户名")}</th>
              <th className="px-6 py-3">{t("Display Name", "显示名称")}</th>

              {/* 密码列 */}
              <th className="px-6 py-3 w-32">{t("Password", "密码")}</th>

              {activeTab === "TEAM" ? (
                <>
                  <th className="px-6 py-3">{t("Type", "类型")}</th>
                  <th className="px-6 py-3">{t("School", "学校")}</th>
                  <th className="px-6 py-3">{t("Coach", "教练")}</th>
                  <th className="px-6 py-3">{t("Seat", "座位")}</th>
                  <th className="px-6 py-3">{t("Auto Login IP", "自动登录 IP")}</th>
                  <th className="px-6 py-3">{t("Last Login IP", "上次登录 IP")}</th>
                </>
              ) : (
                <>
                  <th className="px-6 py-3">{t("Role", "角色")}</th>
                  <th className="px-6 py-3">{t("Last Login IP", "上次登录 IP")}</th>
                </>
              )}
              <th className="px-6 py-3 text-right">{t("Action", "操作")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {initialUsers.map((user: User) => (
              <tr key={user.id} className="hover:bg-gray-50 group">
                <td className="px-6 py-3">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    checked={selectedUserIds.has(user.id)}
                    onChange={(e) =>
                      handleSelectUser(user.id, e.target.checked)
                    }
                  />
                </td>
                <td className="px-6 py-3 font-mono font-medium text-blue-600">
                  {user.username}
                </td>
                <td className="px-6 py-3 font-bold text-gray-800">
                  {user.displayName}
                </td>

                {/* 密码列显示 */}
                <td className="px-6 py-3 font-mono">
                  {showPasswords ? (
                    <span className="text-red-600 bg-red-50 px-1 rounded select-all">
                      {user.plainPassword || "N/A"}
                    </span>
                  ) : (
                    <span className="text-gray-400">••••••••</span>
                  )}
                </td>

                {activeTab === "TEAM" ? (
                  <>
                    <td className="px-6 py-3">
                      <TeamCategoryBadge category={user.category} />
                    </td>
                    <td className="px-6 py-3 text-gray-500">
                      {user.school || "-"}
                    </td>
                    <td className="px-6 py-3 text-gray-500">
                      {user.coach || "-"}
                    </td>
                    <td className="px-6 py-3 font-mono text-gray-500">
                      {user.seat || "-"}
                    </td>
                    <td className="px-6 py-3 font-mono text-xs text-gray-500">
                      {user.autoLoginIp || "-"}
                    </td>
                    <td className="px-6 py-3 font-mono text-xs text-gray-500">
                      {user.lastLoginIp ? (
                        <div
                          title={
                            user.lastLoginAt
                              ? new Date(user.lastLoginAt).toLocaleString()
                              : ""
                          }
                        >
                          {user.lastLoginIp}
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-6 py-3">
                      <span className="bg-gray-100 px-1.5 py-0.5 rounded text-xs border">
                        {user.role}
                      </span>
                    </td>
                    <td className="px-6 py-3 font-mono text-xs text-gray-500">
                      {user.lastLoginIp ? (
                        <div
                          title={
                            user.lastLoginAt
                              ? new Date(user.lastLoginAt).toLocaleString()
                              : ""
                          }
                        >
                          {user.lastLoginIp}
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                  </>
                )}

                <td className="px-6 py-3 text-right flex justify-end gap-2">
                  <button
                    onClick={() => setEditingUser(user)}
                    className="text-blue-500 hover:text-blue-700 p-1.5 rounded hover:bg-blue-50 transition-colors cursor-pointer"
                    title={t("Edit User", "编辑账号")}
                  >
                    <PencilSquareIcon className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => setDeletingUser(user)}
                    className="text-gray-400 hover:text-red-600 p-1.5 rounded hover:bg-red-50 transition-colors cursor-pointer"
                    title={t("Delete User", "删除账号")}
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
            {initialUsers.length === 0 && (
              <tr>
                <td
                  colSpan={activeTab === "TEAM" ? 11 : 7}
                  className="px-6 py-8 text-center text-gray-400 italic"
                >
                  {t("No users found. Import them above.", "暂无账号，可以在上方导入。")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editingUser && (
        <EditUserModal
          user={editingUser}
          contestId={contestId}
          onClose={() => setEditingUser(null)}
        />
      )}
    </div>
  );
}
