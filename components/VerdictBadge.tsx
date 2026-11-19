import { Verdict } from "@/lib/generated/prisma/enums";
import { getVerdictLabel } from "@/lib/dictionaries";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationCircleIcon,
  ClockIcon,
} from "@heroicons/react/24/outline";

// 自定义雪花图标
function SnowflakeIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className={className}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 2.25V21.75M2.25 12H21.75M5.25 5.25L18.75 18.75M18.75 5.25L5.25 18.75M12 6L10 4M12 6L14 4M12 18L10 20M12 18L14 20M6 12L4 10M6 12L4 14M18 12L20 10M18 12L20 14"
      />
    </svg>
  );
}

// 映射表：将数据库的枚举值映射为前端显示的文字和样式
const VERDICT_CONFIG: Record<
  string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { color: string; icon?: any }
> = {
  // --- 等待/评测中 (带动画) ---
  [Verdict.PENDING]: { color: "text-gray-500" },
  [Verdict.JUDGING]: { color: "text-blue-600" },

  // 封榜
  ["FROZEN"]: {
    color: "text-sky-500 font-bold", // 冰雪配色
    icon: SnowflakeIcon,
  },

  ["REJECTED"]: {
    color: "text-red-600 font-bold",
    icon: XCircleIcon,
  },

  // --- 最终状态 ---
  [Verdict.ACCEPTED]: {
    color: "text-green-600 font-bold",
    icon: CheckCircleIcon,
  },
  [Verdict.WRONG_ANSWER]: {
    color: "text-red-600 font-bold",
    icon: XCircleIcon,
  },
  [Verdict.TIME_LIMIT_EXCEEDED]: {
    color: "text-orange-600 font-bold",
    icon: ClockIcon,
  },
  [Verdict.MEMORY_LIMIT_EXCEEDED]: {
    color: "text-orange-600 font-bold",
    icon: ExclamationCircleIcon,
  },
  [Verdict.RUNTIME_ERROR]: {
    color: "text-purple-600 font-bold",
    icon: ExclamationCircleIcon,
  },
  [Verdict.COMPILE_ERROR]: {
    color: "text-yellow-600 font-bold",
    icon: ExclamationCircleIcon,
  },
  [Verdict.PRESENTATION_ERROR]: {
    color: "text-orange-500 font-bold",
    icon: ExclamationCircleIcon,
  },
  [Verdict.SYSTEM_ERROR]: {
    color: "text-gray-900 font-bold",
    icon: ExclamationCircleIcon,
  },
};

export default function VerdictBadge({ status }: { status: string }) {
  // 默认配置 (防止未知状态报错)
  const config = VERDICT_CONFIG[status] || {
    color: "text-gray-400",
  };

  // 判断是否需要 Loading 动画
  const isLoading = status === "PENDING" || status === "JUDGING";
  const Icon = config.icon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${config.color} text-sm`}
    >
      {/* 1. Loading 状态显示旋转图标 */}
      {isLoading && <ArrowPathIcon className="w-4 h-4 animate-spin" />}

      {/* 2. 完成状态显示静态图标 (可选，不想要图标可以删掉这行) */}
      {!isLoading && Icon && <Icon className="w-4 h-4" />}

      {/* 3. 文字 */}
      <span>{getVerdictLabel(status)}</span>
    </span>
  );
}
