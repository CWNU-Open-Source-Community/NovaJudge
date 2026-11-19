import { requireContestAccess } from "@/lib/contest-access";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getClarificationDetail,
  toggleClarificationVisibility,
} from "../actions";
import {
  EyeIcon,
  EyeSlashIcon,
  UserCircleIcon,
  ClockIcon,
} from "@heroicons/react/24/outline";
import { ContestRole } from "@/lib/generated/prisma/enums";
import { getDictionary, getLanguage } from "@/lib/get-dictionary";
import { formatMessage, getLocale } from "@/lib/dictionaries";

import { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { ClarificationReplyForm } from "../ClarificationForm";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const contestId = parseInt((await params).contestId);
  await requireContestAccess(contestId);

  const contest = await prisma.contest.findFirst({
    where: {
      id: contestId,
    },
  });

  const dict = await getDictionary();
  if (!contest) {
    return {
      title: dict.contestList.notFound,
    };
  }
  return {
    title: `${dict.nav.clarifications} - ${contest.title}`,
  };
}

interface Props {
  params: Promise<{
    contestId: string;
    clariId: string;
  }>;
}

export default async function ClarificationDetail({ params }: Props) {
  const { contestId, clariId } = await params;
  const cid = Number(contestId);
  await requireContestAccess(cid);
  const id = Number(clariId);

  const data = await getClarificationDetail(cid, id);

  if (!data) notFound();

  const { thread, isAdmin, currentUserId } = data;
  const [dict, lang] = await Promise.all([getDictionary(), getLanguage()]);
  const formatDate = (date: Date) => {
    return new Date(date).toLocaleString(getLocale(lang));
  };

  return (
    <div className="mx-auto pb-10">
      {/* Top Bar */}
      <div className="flex items-center justify-between mb-6">
        <Link
          href={`/contest/${contestId}/clarifications`}
          className="text-sm font-medium text-gray-500 hover:text-blue-600 flex items-center gap-1 transition-colors"
        >
          &larr; {dict.clarifications.backToList}
        </Link>

        {/* 【新增功能】管理员控制面板 */}
        {isAdmin && (
          <form
            action={toggleClarificationVisibility.bind(
              null,
              cid,
              id,
              thread.isPublic
            )}
          >
            <button
              type="submit"
              className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold border transition-colors ${
                thread.isPublic
                  ? "bg-red-50 text-red-600 border-red-200 hover:bg-red-100"
                  : "bg-green-50 text-green-600 border-green-200 hover:bg-green-100"
              }`}
            >
              {thread.isPublic ? (
                <>
                  <EyeSlashIcon className="w-4 h-4" /> {dict.clarifications.makePrivate}
                </>
              ) : (
                <>
                  <EyeIcon className="w-4 h-4" /> {dict.clarifications.makePublic}
                </>
              )}
            </button>
          </form>
        )}
      </div>

      {/* --- Main Post --- */}
      <div
        className={`bg-white border rounded-lg shadow-sm overflow-hidden mb-8 ${
          thread.isPublic ? "border-orange-300" : "border-gray-200"
        }`}
      >
        {/* Header */}
        <div
          className={`px-6 py-5 border-b ${
            thread.isPublic
              ? "bg-orange-50 border-orange-100"
              : "bg-gray-50 border-gray-100"
          }`}
        >
          <div className="flex justify-between items-start">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span
                  className={`text-xs font-bold px-2 py-0.5 rounded border uppercase tracking-wide ${
                    thread.isPublic
                      ? "bg-orange-200 text-orange-800 border-orange-300"
                      : "bg-gray-200 text-gray-700 border-gray-300"
                  }`}
                >
                  {thread.isPublic ? dict.clarifications.publicThread : dict.clarifications.privateThread}
                </span>
                {thread.displayId && (
                  <span className="text-xs font-mono font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                    {formatMessage(dict.clarifications.problemNumber, { problem: thread.displayId })}
                  </span>
                )}
              </div>
              <h1 className="text-2xl font-bold text-gray-900 font-serif leading-tight">
                {thread.title}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <UserCircleIcon className="w-4 h-4" />
              {thread.user?.displayName || thread.user?.username || dict.common.unknown}
            </span>
            <span className="flex items-center gap-1">
              <ClockIcon className="w-4 h-4" />
              {formatDate(thread.createdAt)}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="p-8 text-gray-800 leading-relaxed text-base whitespace-pre-wrap">
          {thread.content}
        </div>
      </div>

      {/* --- Replies Section --- */}
      <div className="space-y-6">
        {thread.replies.map((reply) => {
          // 判断是否是当前登录用户发的
          const isMe = reply.userId === currentUserId;
          // 判断回复者身份是否是管理员/裁判
          const isReplyByStaff =
            reply.user?.role === ContestRole.ADMIN ||
            reply.user?.role === ContestRole.JUDGE;

          return (
            <div
              key={reply.id}
              className={`flex gap-4 ${isMe ? "flex-row-reverse" : ""}`}
            >
              {/* Avatar Placeholder */}
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 border ${
                  isMe
                    ? "bg-blue-600 text-white border-blue-600" // 自己：深蓝背景
                    : isReplyByStaff
                    ? "bg-orange-100 text-orange-600 border-orange-200" // 管理员：橙色背景
                    : "bg-gray-100 text-gray-500 border-gray-200" // 路人：灰色背景
                }`}
                title={reply.user?.username}
              >
                <span className="font-bold text-xs">
                  {isMe ? dict.clarifications.avatarSelf : isReplyByStaff ? dict.clarifications.avatarStaff : dict.clarifications.avatarUser}
                </span>
              </div>

              {/* Chat Bubble */}
              <div
                className={`max-w-[85%] rounded-2xl p-4 shadow-sm border text-sm leading-relaxed whitespace-pre-wrap ${
                  isMe
                    ? "bg-blue-50 border-blue-100 rounded-tr-sm text-gray-800" // 自己：浅蓝气泡，直角在右上
                    : "bg-white border-gray-200 rounded-tl-sm text-gray-800" // 别人：白色气泡，直角在左上
                }`}
              >
                <div
                  className={`flex items-center gap-2 mb-2 text-xs ${
                    isMe ? "justify-end opacity-70" : "opacity-70"
                  }`}
                >
                  {/* 这里处理名字显示逻辑：如果是别人发的，显示名字和头衔 */}
                  {!isMe && (
                    <span className="font-bold flex items-center gap-1">
                      {reply.user?.displayName || reply.user?.username}
                      {isReplyByStaff && (
                        <span className="bg-orange-500 text-white px-1.5 rounded-sm text-[10px]">
                          {dict.clarifications.staff}
                        </span>
                      )}
                    </span>
                  )}

                  <span className="font-mono text-gray-400">
                    {formatDate(reply.createdAt)}
                  </span>
                </div>

                <div className={isMe ? "text-right" : "text-left"}>
                  {reply.content}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <ClarificationReplyForm contestId={contestId} clariId={clariId} isAdmin={isAdmin} />
    </div>
  );
}
