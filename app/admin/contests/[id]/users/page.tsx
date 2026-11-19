import { createAdminLocale } from "@/lib/admin-locale";
import { getLanguage } from "@/lib/get-dictionary";
import Link from "next/link";
import { getContestUsers } from "./actions";
import ImportForm from "./ImportForm";
import ClientUserTable from "./ClientUserTable";
import {
  ArrowLeftIcon,
  UserGroupIcon,
  IdentificationIcon,
} from "@heroicons/react/24/outline";

export default async function ContestUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { t } = createAdminLocale(await getLanguage());
  const { id } = await params;
  const { tab } = await searchParams;
  const contestId = Number(id);
  const activeTab = tab === "staff" ? "STAFF" : "TEAM";

  // Server Side 获取数据
  const users = await getContestUsers(contestId, activeTab);

  return (
    <div className="max-w-6xl mx-auto pb-10">
      <div className="mb-8 flex items-center gap-4">
        <Link
          href="/admin/contests"
          className="p-2 rounded-full hover:bg-gray-100 text-gray-500 transition-colors"
        >
          <ArrowLeftIcon className="w-6 h-6" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{t("Contest Users", "比赛账号")}</h1>
          <p className="text-gray-500">
            {t("Manage participants and staff for Contest #", "管理比赛账号 #")}{contestId}
          </p>
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="flex gap-6 border-b border-gray-200 mb-8">
        <Link
          href={`?tab=teams`}
          className={`pb-3 px-2 flex items-center gap-2 font-bold text-sm transition-all ${
            activeTab === "TEAM"
              ? "border-b-2 border-blue-600 text-blue-600"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <UserGroupIcon className="w-5 h-5" />
          {t("Teams (", "队伍（")}{activeTab === "TEAM" ? users.length : "..."})
        </Link>
        <Link
          href={`?tab=staff`}
          className={`pb-3 px-2 flex items-center gap-2 font-bold text-sm transition-all ${
            activeTab === "STAFF"
              ? "border-b-2 border-purple-600 text-purple-600"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <IdentificationIcon className="w-5 h-5" />
          {t("Staff & Judges (", "工作人员与裁判（")}{activeTab === "STAFF" ? users.length : "..."})
        </Link>
      </div>

      {/* 导入表单 */}
      <div className="bg-white shadow rounded-lg border border-gray-200 p-6 mb-8">
        <h3 className="text-lg font-bold text-gray-800 mb-4">
          {t("Batch Import", "批量导入")} {activeTab === "TEAM" ? t("Teams", "队伍") : t("Staff", "工作人员")}
        </h3>
        <ImportForm contestId={contestId} type={activeTab} />
      </div>

      {/* 用户列表 (客户端组件，处理导出和编辑) */}
      <ClientUserTable
        initialUsers={users}
        contestId={contestId}
        activeTab={activeTab}
      />
    </div>
  );
}
