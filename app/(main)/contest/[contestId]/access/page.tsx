import type { Metadata } from "next";
import Link from "next/link";
import { LockClosedIcon } from "@heroicons/react/24/outline";
import { notFound, redirect } from "next/navigation";
import { getContestAccess } from "@/lib/contest-access";
import AccessForm from "./AccessForm";
import { getDictionary } from "@/lib/get-dictionary";
import { formatMessage } from "@/lib/dictionaries";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return {
    title: dict.contestAccess.title,
    robots: { index: false, follow: false },
  };
}

export default async function ContestAccessPage({ params }: {
  params: Promise<{ contestId: string }>;
}) {
  const contestId = Number((await params).contestId);
  const { contest, allowed } = await getContestAccess(contestId);
  if (!contest) notFound();
  if (allowed) redirect(`/contest/${contestId}`);
  const dict = await getDictionary();

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        <LockClosedIcon className="mb-4 h-10 w-10 text-blue-600" />
        <h1 className="text-2xl font-bold text-gray-900">{formatMessage(dict.contestAccess.heading, { id: contestId })}</h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">
          {dict.contestAccess.description}
        </p>
        {contest.password ? <AccessForm contestId={contestId} /> : (
          <p className="mt-6 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            {dict.contestAccess.unconfigured}
          </p>
        )}
        <Link href="/" className="mt-5 block text-center text-sm text-blue-600 hover:underline">{dict.common.backToContests}</Link>
      </div>
    </div>
  );
}
