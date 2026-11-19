import Link from "next/link";
import Pagination from "@/components/admin/AdminPagination";
import { AdminPageHeader, AdminTable } from "@/components/admin/AdminPage";
import { createAdminLocale } from "@/lib/admin-locale";
import { getLanguage } from "@/lib/get-dictionary";
import { getExternalAccounts } from "./actions";
import AccountBanButton from "./AccountBanButton";
import {
  MagnifyingGlassIcon,
  NoSymbolIcon,
} from "@heroicons/react/24/outline";

const EXTERNAL_ACCOUNTS_PAGE_SIZE = 20;

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    q?: string;
    status?: string;
  }>;
}) {
  const { page, q, status } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);
  const data = await getExternalAccounts({
    page: currentPage,
    pageSize: EXTERNAL_ACCOUNTS_PAGE_SIZE,
    query: q,
    status,
  });

  const { t, locale } = createAdminLocale(await getLanguage());
  const stats = [
    { label: t("Total", "外部账号总数"), value: data.summary.total, color: "text-gray-900" },
    { label: t("Active", "正常"), value: data.summary.active, color: "text-emerald-700" },
    { label: t("Banned", "已封禁"), value: data.summary.banned, color: "text-red-700" },
  ];

  return (
    <div className="space-y-5">
      <AdminPageHeader title={t("External Accounts", "外部账号")} description={t("Find accounts from the external identity provider and manage access.", "查找通过外部身份认证创建的账号，并管理访问权限。")} />
      <dl className="grid grid-cols-3 gap-2.5 sm:gap-4">
        {stats.map(({ label, value, color }) => (
          <div key={label} className="admin-card p-3 sm:p-4">
            <dt className="text-xs font-medium text-gray-600 sm:text-sm">{label}</dt>
            <dd className={`mt-1.5 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl ${color}`}>{value.toLocaleString(locale)}</dd>
          </div>
        ))}
      </dl>

      <section className="admin-card overflow-hidden">
        <form role="search" className="grid gap-3 p-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,12rem)] sm:p-4 xl:grid-cols-[minmax(0,1fr)_minmax(8rem,12rem)_auto] xl:items-end">
          <label className="grid gap-1.5 text-sm font-medium text-gray-700">
            {t("Search accounts", "搜索账号")}
            <span className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute top-3 left-3 size-4 text-gray-500" aria-hidden="true" />
              <input type="search" name="q" defaultValue={data.query} placeholder={t("Name, student ID, email, or external ID", "姓名、账号、学号、邮箱或外部 ID")} className="admin-input pl-9" />
            </span>
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-gray-700">
            {t("Status", "状态")}
            <select name="status" defaultValue={data.status} className="admin-input">
              <option value="all">{t("All accounts", "全部账号")}</option>
              <option value="active">{t("Active only", "仅正常账号")}</option>
              <option value="banned">{t("Banned only", "仅已封禁账号")}</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-1">
            <button type="submit" className="admin-button admin-button-primary">{t("Search", "搜索")}</button>
            <Link href="/admin/accounts" className="admin-button">{t("Reset", "重置")}</Link>
          </div>
        </form>

        <AdminTable label={t("External accounts", "外部账号列表")} className="min-w-[41rem]">
          <thead>
            <tr>
              <th scope="col">{t("User", "用户")}</th>
              <th scope="col">{t("Identity", "身份信息")}</th>
              <th scope="col">{t("External ID", "外部 ID")}</th>
              <th scope="col">{t("Submissions", "提交")}</th>
              <th scope="col">{t("Created", "创建时间")}</th>
              <th scope="col">{t("Status", "状态")}</th>
              <th scope="col" className="text-right">{t("Actions", "操作")}</th>
            </tr>
          </thead>
          <tbody>
            {data.accounts.map((account) => (
              <tr key={account.id}>
                <th scope="row" className="min-w-28 text-left align-top">
                  <div className="wrap-break-word font-semibold text-gray-900">{account.displayName || account.username}</div>
                  <div className="mt-1 wrap-break-word font-mono text-xs font-normal text-gray-600">@{account.username}</div>
                </th>
                <td className="align-top">
                  <div className="text-xs text-gray-700">{t("Student ID", "学号")} {account.studentId || "—"}</div>
                  <div className="mt-1 break-all text-xs text-gray-600">{account.email || "—"}</div>
                </td>
                <td className="align-top font-mono text-xs text-gray-600">{account.externalId || "—"}</td>
                <td className="align-top tabular-nums">{account._count.submissions.toLocaleString(locale)}</td>
                <td className="min-w-28 align-top text-xs text-gray-600">
                  <time dateTime={account.createdAt.toISOString()}>{account.createdAt.toLocaleDateString(locale)}</time>
                </td>
                <td className="align-top">
                  <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium ${account.isBanned ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                    {account.isBanned && <NoSymbolIcon className="size-3.5" aria-hidden="true" />}
                    {account.isBanned ? t("Banned", "已封禁") : t("Active", "正常")}
                  </span>
                </td>
                <td className="text-right align-top">
                  <AccountBanButton userId={account.id} username={account.username} isBanned={account.isBanned} />
                </td>
              </tr>
            ))}
            {data.accounts.length === 0 && <tr><td colSpan={7} className="text-center"><p className="py-7 text-sm text-gray-600">{t("No matching external accounts.", "没有符合条件的外部账号。")}</p></td></tr>}
          </tbody>
        </AdminTable>
        <div className="admin-table-footer"><Pagination totalItems={data.total} pageSize={EXTERNAL_ACCOUNTS_PAGE_SIZE} /></div>
      </section>
    </div>
  );
}
