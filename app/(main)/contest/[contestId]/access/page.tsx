import type { Metadata } from "next";
import Link from "next/link";
import { LockClosedIcon } from "@heroicons/react/24/outline";
import { notFound, redirect } from "next/navigation";
import { getContestAccess } from "@/lib/contest-access";
import AccessForm from "./AccessForm";

export const metadata: Metadata = {
  title: "私有赛 · 密码验证",
  robots: { index: false, follow: false },
};

export default async function ContestAccessPage({ params }: {
  params: Promise<{ contestId: string }>;
}) {
  const contestId = Number((await params).contestId);
  const { contest, allowed } = await getContestAccess(contestId);
  if (!contest) notFound();
  if (allowed) redirect(`/contest/${contestId}`);

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        <LockClosedIcon className="mb-4 h-10 w-10 text-blue-600" />
        <h1 className="text-2xl font-bold text-gray-900">私有赛 #{contestId}</h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">
          验证比赛密码后才能查看比赛信息、题目、榜单和提交记录。比赛结束后仍需验证。
        </p>
        {contest.password ? <AccessForm contestId={contestId} /> : (
          <p className="mt-6 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            该私有赛尚未配置访问密码，请联系比赛管理员。
          </p>
        )}
        <Link href="/" className="mt-5 block text-center text-sm text-blue-600 hover:underline">返回比赛列表</Link>
      </div>
    </div>
  );
}
