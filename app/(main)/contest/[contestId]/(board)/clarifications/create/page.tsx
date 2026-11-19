import { requireContestAccess } from "@/lib/contest-access";
import { publishAnnouncement } from "../actions";
import Link from "next/link";
import { MegaphoneIcon } from "@heroicons/react/24/outline";
import { getDictionary } from "@/lib/get-dictionary";

export default async function CreateAnnouncementPage({
  params,
}: {
  params: Promise<{ contestId: string }>;
}) {
  const { contestId } = await params;
  await requireContestAccess(Number(contestId));
  const { clarifications } = await getDictionary();
  const [visibilityPrefix, visibilitySuffix] = clarifications.announcementVisibility.split("{visibility}");

  return (
    <div className="mx-auto pt-4 pb-12">
      <div className="mb-6">
        <Link
          href={`/contest/${contestId}/clarifications`}
          className="text-sm text-gray-500 hover:text-gray-900 font-medium"
        >
          &larr; {clarifications.backToList}
        </Link>
        <h1 className="text-3xl font-serif font-bold text-gray-900 mt-4 flex items-center gap-3">
          <MegaphoneIcon className="w-8 h-8 text-orange-600" />
          {clarifications.postAnnouncement}
        </h1>
      </div>

      <div className="bg-white shadow-lg border-t-4 border-orange-500 rounded-b-lg p-8">
        <p className="text-gray-600 text-sm mb-6 pb-6 border-b border-gray-100">
          {visibilityPrefix}
          <span className="font-bold text-orange-600">{clarifications.publicThread}</span>
          {visibilitySuffix}
        </p>

        <form action={publishAnnouncement} className="space-y-6">
          <input type="hidden" name="contestId" value={contestId} />

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">
              {clarifications.title}
            </label>
            <input
              name="title"
              required
              className="w-full bg-gray-50 rounded border border-gray-300 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
              placeholder={clarifications.announcementTitleExample}
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">
              {clarifications.content}
            </label>
            <textarea
              name="content"
              required
              rows={8}
              className="w-full bg-gray-50 rounded border border-gray-300 px-4 py-3 text-gray-900 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
              placeholder={clarifications.announcementBodyPlaceholder}
            />
          </div>

          <div className="pt-4 flex items-center justify-end gap-4">
            <button
              type="submit"
              className="bg-orange-600 text-white px-8 py-3 rounded-md font-bold hover:bg-orange-700 shadow-md transition-transform active:scale-95"
            >
              {clarifications.publishNow}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
