import { getDictionary } from "@/lib/get-dictionary";
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
  const dict = await getDictionary();
  const memoryLimit = info.memoryLimit;
  return (
    <div className="bg-white border border-gray-200 shadow-sm rounded-sm overflow-hidden w-full lg:w-72 shrink-0">
      <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
        <h3 className="font-bold text-gray-700">{dict.common.information}</h3>
      </div>
      <ul className="text-sm divide-y divide-gray-100 font-serif">
        <li className="px-4 py-3 flex justify-between">
          <span className="text-gray-500">Problem Id</span>
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
            {dict.problemDetail.timeLimit} (Java / Others)
          </div>
          <div className="font-bold text-gray-800 text-lg">
            {2 * info.timeLimit} / <span className="time-limit">{info.timeLimit}</span> MS
          </div>
        </li>
        <li className="px-4 py-3">
          <div className="text-gray-500 mb-1">
            {dict.problemDetail.memoryLimit} (Java / Others)
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
      <div className="p-4 bg-gray-50 border-t border-gray-100 flex flex-col gap-2 font-serif">
        {/* 🔘 动态按钮逻辑 */}
        {type === "problem" ? (
          // 情况 A: 在题目页 -> 显示 "Submit" 按钮，去往提交页
          isAdmin ? (
            <button
              disabled
              className="w-full bg-gray-400 text-white text-center py-2 rounded-sm font-bold shadow-sm cursor-not-allowed opacity-60"
              title="Cannot submit"
            >
              {dict.common.submit}
            </button>
          ) : (
            <Link
              href={`/contest/${contestId}/submit?problem=${problemId}`}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white text-center py-2 rounded-sm font-bold shadow-sm transition-colors"
            >
              {dict.common.submit}
            </Link>
          )
        ) : (
          // 情况 B: 在提交页 -> 显示 "< Problem" 按钮，回题目页(
          <Link
            href={`/contest/${contestId}/problems/${problemId}`}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white text-center py-2 rounded-sm font-bold shadow-sm transition-colors"
          >
            &lt; &nbsp; {dict.common.problem}
          </Link>
        )}

        {/* 第二个按钮：始终显示 Submissions */}
        <Link
          href={`/contest/${contestId}/status?problem=${problemId}`}
          className="w-full bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-center py-2 rounded-sm font-medium transition-colors"
        >
          {dict.nav.status}
        </Link>
      </div>
    </div>
  );
}
