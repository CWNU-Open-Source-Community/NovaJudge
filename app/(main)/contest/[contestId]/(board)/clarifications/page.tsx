import { requireContestAccess } from "@/lib/contest-access";
import Link from "next/link";
import Pagination from "@/components/Pagination";
import { getClarificationData } from "./actions";
import {
  MegaphoneIcon,
  ChatBubbleLeftRightIcon,
  LockClosedIcon,
  UserCircleIcon,
  GlobeAltIcon,
  TagIcon, // 新增图标
} from "@heroicons/react/24/outline";
import { getCurrentUser } from "@/lib/auth";
import { ClariCategory } from "@/lib/generated/prisma/client";
import { getDictionary } from "@/lib/get-dictionary";
import ClarificationForm from "./ClarificationForm";
import { Metadata } from "next";
import { prisma } from "@/lib/prisma";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const contestId = parseInt((await params).contestId);
  await requireContestAccess(contestId);

  const contest = await prisma.contest.findFirst({
    where: {
      id: contestId,
    },
  });

  if (!contest) {
    return {
      title: "比赛未找到",
    };
  }
  return {
    title: `Q&A - ${contest.title}`,
  };
}
interface Props {
  searchParams: Promise<{
    page?: string;
  }>;
  params: Promise<{
    contestId: string;
  }>;
}

export default async function ClarificationsPage({
  params,
  searchParams,
}: Props) {
  const { contestId } = await params;
  const { page } = await searchParams;
  const cid = Number(contestId);
  await requireContestAccess(cid);

  const { notifications, clarifications, total, problems, isAdmin } =
    await getClarificationData(cid, Number(page) || 1);

  const formatTime = (d: Date) => {
    return new Date(d).toLocaleString();
  };

  // 将 notifications 拆分为 公告(Notice) 和 公开提问(PublicQuestion)
  const announcements = notifications.filter(
    (n) => n.category === ClariCategory.NOTICE,
  );
  const publicQuestions = notifications.filter(
    (n) => n.category === ClariCategory.QUESTION,
  );

  const currentUser = await getCurrentUser();
  const now = new Date();

  const dict = await getDictionary();
  return (
    <div className="space-y-10 pb-12 max-w-7xl mx-auto">
      {/* --- Section 1: Official Announcements (拆分出的公告区) --- */}
      <section>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2 font-serif border-b-2 border-orange-500 pb-1">
            <span className="text-orange-600">
              <MegaphoneIcon className="w-6 h-6" />
            </span>
            {dict.clarifications.announcement}
          </h2>
          {isAdmin && (
            <Link
              href={`/contest/${contestId}/clarifications/create`}
              className="text-sm font-bold text-white bg-orange-600 px-4 py-2 rounded-md hover:bg-orange-700 transition shadow-sm flex items-center gap-2"
            >
              + New Notice
            </Link>
          )}
        </div>

        {announcements.length === 0 ? (
          <div className="bg-orange-50/50 border border-orange-100 border-dashed rounded-lg p-6 text-center text-gray-400 text-sm">
            No official announcements yet.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {announcements.map((note) => {
              // 计算是否为最新发布 (1小时内 = 3600000 毫秒)
              const isNew =
                now.getTime() - new Date(note.createdAt).getTime() <
                1000 * 60 * 60;

              return (
                <Link
                  key={note.id}
                  href={`/contest/${contestId}/clarifications/${note.id}`}
                  className="block bg-white border-l-4 border-l-orange-500 shadow-sm hover:shadow-md transition-shadow p-5 rounded-r-lg"
                >
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="text-lg font-bold text-gray-900 group-hover:text-orange-700 flex items-center gap-2">
                      {note.title}
                      {isNew && (
                        <span className="bg-red-600 text-white text-[10px] px-1.5 py-0.5 rounded-sm font-bold animate-pulse shadow-sm">
                          NEW
                        </span>
                      )}
                    </h3>
                    <span className="text-xs font-mono text-gray-400 whitespace-nowrap ml-4">
                      {formatTime(note.createdAt)}
                    </span>
                  </div>
                  <div className="text-gray-700 text-sm whitespace-pre-wrap leading-relaxed line-clamp-3">
                    {note.content}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* --- Section 2: Public Q&A (拆分出的公开提问区) --- */}
      {publicQuestions.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <span className="bg-blue-50 text-blue-600 p-1.5 rounded-md">
              <GlobeAltIcon className="w-5 h-5" />
            </span>
            <h2 className="text-lg font-bold text-gray-800 font-serif">
              {dict.clarifications.public}
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4">
            {publicQuestions.map((note) => (
              <Link
                key={note.id}
                href={`/contest/${contestId}/clarifications/${note.id}`}
                className="group block bg-white border border-l-4 border-gray-200 border-l-sky-500 rounded-r-lg shadow-sm hover:shadow-md transition-all p-5 relative overflow-hidden"
              >
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-bold text-gray-900 group-hover:text-blue-600 transition-colors text-lg truncate pr-8">
                    {note.title || "No Title"}
                  </h3>
                  {note._count.replies > 0 && (
                    <span className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-full font-bold">
                      {note._count.replies}{" "}
                      <ChatBubbleLeftRightIcon className="w-3 h-3" />
                    </span>
                  )}
                </div>
                <div className="text-sm text-gray-600 line-clamp-2 mb-3 h-10">
                  {note.content}
                </div>
                <div className="flex items-center justify-between text-xs text-gray-400 font-mono border-t border-gray-50 pt-3">
                  <span className="flex items-center gap-1">
                    <TagIcon className="w-3 h-3" />
                    {note.category === ClariCategory.NOTICE
                      ? "Announcement"
                      : "Public Q&A"}
                  </span>
                  <span>{formatTime(note.createdAt)}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* --- Section 3: Inbox (Private Questions) --- */}
      <section>
        <div className="flex items-center gap-2 mb-4 border-b border-gray-200 pb-2 mt-8">
          <LockClosedIcon className="w-5 h-5 text-gray-500" />
          <h2 className="text-xl font-bold text-gray-800 font-serif">
            {isAdmin
              ? "Inbox (Private Questions)"
              : `${dict.clarifications.private}`}
          </h2>
        </div>

        {/* ... table content remains the same ... */}
        <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 text-gray-500 font-medium border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 w-32">
                    {dict.clarifications.problem}
                  </th>
                  <th className="px-6 py-3">{dict.clarifications.title}</th>
                  {isAdmin && <th className="px-6 py-3 w-40">Author</th>}
                  <th className="px-6 py-3 w-50">{dict.clarifications.time}</th>
                  <th className="px-6 py-3 w-20 text-center">
                    {dict.clarifications.replay}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {clarifications.map((clari) => (
                  <tr
                    key={clari.id}
                    className="hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-6 py-4 font-mono font-bold text-blue-600">
                      {clari.displayId
                        ? `Problem ${clari.displayId}`
                        : "General"}
                    </td>
                    <td className="px-6 py-4">
                      <Link
                        href={`/contest/${contestId}/clarifications/${clari.id}`}
                        className="text-gray-900 font-medium hover:text-blue-600 block"
                      >
                        {clari.title || "(No Title)"}
                      </Link>
                    </td>
                    {isAdmin && (
                      <td className="px-6 py-4 text-gray-600 flex items-center gap-1.5">
                        <UserCircleIcon className="w-4 h-4 text-gray-400" />
                        {clari.user?.displayName || clari.user?.username}
                      </td>
                    )}
                    <td className="px-6 py-4 text-gray-500 font-mono text-xs">
                      {formatTime(clari.createdAt)}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {clari._count.replies > 0 ? (
                        <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full text-xs font-bold">
                          {clari._count.replies}
                        </span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                  </tr>
                ))}
                {clarifications.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-6 py-12 text-center text-gray-400"
                    >
                      {isAdmin
                        ? "No pending private questions."
                        : "You haven't asked any questions yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {total > 15 && (
            <div className="p-4 border-t border-gray-100">
              <Pagination totalItems={total} pageSize={15} />
            </div>
          )}
        </div>
      </section>

      {/* --- Section 4: Ask Question Form (选手用) --- */}
      {!isAdmin && currentUser && (
        <ClarificationForm contestId={cid} problems={problems} dict={dict} />
      )}
    </div>
  );
}
