import Link from "next/link";
import Pagination from "@/components/Pagination";
import { getExternalAccounts } from "./actions";
import AccountBanButton from "./AccountBanButton";
import {
  MagnifyingGlassIcon,
  NoSymbolIcon,
  UserGroupIcon,
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            External Accounts
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-gray-600">
            Manage users created through the external identity provider. Search
            by username, real name, student ID, email, or external ID, and ban
            or unban access when needed.
          </p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          封禁后，外部登录会被拒绝，现有 auth_token 会在后续请求中失效。
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-medium text-gray-500">
            Total External Users
          </div>
          <div className="mt-3 text-3xl font-bold text-gray-900">
            {data.summary.total}
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <div className="text-sm font-medium text-emerald-700">Active</div>
          <div className="mt-3 text-3xl font-bold text-emerald-900">
            {data.summary.active}
          </div>
        </div>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 shadow-sm">
          <div className="text-sm font-medium text-red-700">Banned</div>
          <div className="mt-3 text-3xl font-bold text-red-900">
            {data.summary.banned}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <form className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px_auto_auto] md:items-end">
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Search
            </label>
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                name="q"
                defaultValue={data.query}
                placeholder="username / display name / student ID / email / external ID"
                className="w-full rounded-xl border border-gray-300 py-2.5 pl-10 pr-3 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Status
            </label>
            <select
              name="status"
              defaultValue={data.status}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              <option value="all">All users</option>
              <option value="active">Active only</option>
              <option value="banned">Banned only</option>
            </select>
          </div>

          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Search
          </button>

          <Link
            href="/admin/accounts"
            className="inline-flex items-center justify-center rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
          >
            Reset
          </Link>
        </form>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {data.accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center text-gray-500">
            <UserGroupIcon className="mb-4 h-12 w-12 text-gray-300" />
            <div className="text-lg font-semibold text-gray-700">
              No matching external users
            </div>
            <p className="mt-2 max-w-md text-sm">
              Adjust your search keywords or status filter to find the account
              you need.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm text-gray-600">
              <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-6 py-4">User</th>
                  <th className="px-6 py-4">Identity</th>
                  <th className="px-6 py-4">External ID</th>
                  <th className="px-6 py-4">Submissions</th>
                  <th className="px-6 py-4">Created</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.accounts.map((account) => (
                  <tr key={account.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 align-top">
                      <div className="font-semibold text-gray-900">
                        {account.displayName || account.username}
                      </div>
                      <div className="mt-1 font-mono text-xs text-gray-500">
                        @{account.username}
                      </div>
                    </td>
                    <td className="px-6 py-4 align-top">
                      <div className="space-y-1">
                        <div>
                          <span className="font-medium text-gray-700">
                            Student ID:
                          </span>{" "}
                          {account.studentId || "-"}
                        </div>
                        <div className="break-all text-gray-500">
                          {account.email || "-"}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 align-top font-mono text-xs text-gray-500">
                      {account.externalId || "-"}
                    </td>
                    <td className="px-6 py-4 align-top">
                      <div className="inline-flex min-w-14 items-center justify-center rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
                        {account._count.submissions}
                      </div>
                    </td>
                    <td className="px-6 py-4 align-top text-sm text-gray-500">
                      {new Date(account.createdAt).toLocaleString("zh-CN")}
                    </td>
                    <td className="px-6 py-4 align-top">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${
                          account.isBanned
                            ? "bg-red-100 text-red-700"
                            : "bg-emerald-100 text-emerald-700"
                        }`}
                      >
                        <NoSymbolIcon className="h-3.5 w-3.5" />
                        {account.isBanned ? "Banned" : "Active"}
                      </span>
                    </td>
                    <td className="px-6 py-4 align-top text-right">
                      <AccountBanButton
                        userId={account.id}
                        username={account.username}
                        isBanned={account.isBanned}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="text-sm text-gray-500">
          Showing{" "}
          {(data.page - 1) * data.pageSize +
            (data.accounts.length === 0 ? 0 : 1)}
          -{(data.page - 1) * data.pageSize + data.accounts.length} of{" "}
          {data.total}
        </div>
        <Pagination
          totalItems={data.total}
          pageSize={EXTERNAL_ACCOUNTS_PAGE_SIZE}
        />
      </div>
    </div>
  );
}
