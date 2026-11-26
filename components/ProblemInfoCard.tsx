import { getDictionary } from "@/lib/get-dictionary";
import { usesDomjudge } from "@/lib/contest-interface";
import Link from "next/link";

interface ProblemInfoProps {
  contestId: string;
  problemId: string;
  info: {
    timeLimit: number;
    memoryLimit: number;
    submissions: number;
    accepted: number;
    problemType?: string;
  };
  type?: "problem" | "submit";
  isAdmin?: boolean;
}

export default async function ProblemInfoCard({
  contestId,
  problemId,
  info,
  type = "problem",
  isAdmin = false,
}: ProblemInfoProps) {
  const [dict, domjudge] = await Promise.all([getDictionary(), usesDomjudge(Number(contestId))]);
  const memoryLimit = info.memoryLimit;
  return (
    <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden w-full lg:w-72 shrink-0">
      <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
        <h3 className="font-bold text-gray-700">{dict.common.information}</h3>
      </div>
      <ul className="text-sm divide-y divide-gray-100 font-serif">
        <li className="px-4 py-3 flex justify-between">
          <span className="text-gray-500">{dict.problemDetail.id}</span>
          <span className="font-mono font-bold text-gray-800">{problemId}</span>
        </li>
        {info.problemType === "communication" && (
          <li className="px-4 py-3">
            <div className="text-gray-500 mb-1">
              {dict.problemDetail.judgeType}
            </div>
            <span className="font-bold text-blue-700">
              {dict.problemDetail.communication}
            </span>
            {type === "submit" && (
              <p className="mt-2 text-xs leading-relaxed text-gray-600">
                {dict.problemDetail.communicationNotice}
              </p>
            )}
          </li>
        )}
        <li className="px-4 py-3">
          <div className="text-gray-500 mb-1">
            {dict.problemDetail.timeLimit} ({dict.problemDetail.javaAndOthers})
          </div>
          <div className="font-bold text-gray-800 text-lg">
            {2 * info.timeLimit} / <span className="time-limit">{info.timeLimit}</span> ms
          </div>
        </li>
        <li className="px-4 py-3">
          <div className="text-gray-500 mb-1">
            {dict.problemDetail.memoryLimit} ({dict.problemDetail.javaAndOthers})
          </div>
          <div className="font-bold text-gray-800 text-lg">
            {2 * memoryLimit} / <span className="memory-limit">{memoryLimit}</span> MB
          </div>
        </li>
        <li className="px-4 py-3 flex justify-between">
          <span className="text-gray-500">{dict.problemDetail.accepted}</span>
          <span className="text-green-600 font-bold">{info.accepted}</span>
        </li>
        <li className="px-4 py-3 flex justify-between">
          <span className="text-gray-500">
            {dict.problemDetail.submissions}
          </span>
          <span className="text-gray-800">{info.submissions}</span>
        </li>
      </ul>

      {/* 操作按钮区 */}
      <div className="p-4 bg-slate-50 border-t border-slate-100 flex flex-col gap-2">
        {/* 🔘 动态按钮逻辑 */}
        {type === "problem" ? (
          // 情况 A: 在题目页 -> 显示 "Submit" 按钮，去往提交页
          isAdmin ? (
            <button
              disabled
              className="w-full bg-slate-400 text-white text-center py-2 rounded-xl font-bold shadow-sm cursor-not-allowed opacity-60"
              title={dict.submit.adminCannotSubmit}
            >
              {dict.common.submit}
            </button>
          ) : (
            <Link
              href={`/contest/${contestId}/submit?problem=${problemId}`}
              className="w-full bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-center py-2 rounded-xl font-bold shadow-sm transition-colors"
            >
              {dict.common.submit}
            </Link>
          )
        ) : (
          // 情况 B: 在提交页 -> 显示 "< Problem" 按钮，回题目页(
          <Link
            href={`/contest/${contestId}/problems/${problemId}`}
            className="w-full bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-center py-2 rounded-xl font-bold shadow-sm transition-colors"
          >
            &lt; &nbsp; {dict.common.problem}
          </Link>
        )}

        {!domjudge && <Link
          href={`/contest/${contestId}/status?problem=${problemId}`}
          className="w-full bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-center py-2 rounded-xl font-medium transition-colors"
        >
          {dict.nav.status}
        </Link>}
      </div>
    </div>
  );
}
