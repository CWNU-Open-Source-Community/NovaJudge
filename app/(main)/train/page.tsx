import { getCurrentSuper } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  FolderIcon,
  DocumentIcon,
  HomeIcon,
} from "@heroicons/react/24/outline";
import { TrainingNode } from "@/lib/generated/prisma/client";
import { Metadata } from "next";
import { hasContestAccess } from "@/lib/contest-access";

export const metadata: Metadata = {
  title: "训练中心",
};

interface FileItem {
  id: string; // contestId
  name: string; // contestTitle
  type: "file";
  problems: {
    letter: string; // A, B, C...
    status: "passed" | "attempted" | "none";
  }[];
  solvedCount: number;
  totalCount: number;
  link: string;
  locked?: boolean;
}

interface FolderItem {
  id: string; // folderId
  name: string; // folderName
  type: "folder";
  link: string;
  contestCount: number;
  solvedCount: number;
  totalCount: number;
}

type FileSystemItem = FileItem | FolderItem;

// ================= 主组件 =================

export default async function TrainingCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ path?: string }>;
}) {
  const { path = "/" } = await searchParams;

  // 1. 鉴权：必须是全局登录用户
  const payload = await getCurrentSuper();

  if (!payload || !payload.userId) {
    redirect("/?login=true"); // 未登录跳转首页并触发登录框
  }

  const globalUserId = String(payload.userId);

  // 2. 获取当前目录下的所有节点
  const currentPath = path.replace(/\/$/, "") || "/";
  let parentId: string | null = null;
  let curName: string | null = null;
  // 初始化面包屑
  const breadcrumbs: { name: string; path: string }[] = [
    { name: "Root", path: "/train" },
  ];

  if (currentPath !== "/") {
    const segments = currentPath.split("/").filter(Boolean);
    let curr: string | null = null;
    let validPath = "/train?path=";

    for (const [idx, segment] of segments.entries()) {
      const node: TrainingNode | null = await prisma.trainingNode.findFirst({
        where: {
          parentId: curr,
          type: "FOLDER",
          OR: [{ slug: segment }, { id: segment }],
        },
      });

      if (node) {
        curr = node.id;
        curName = node.name || node.id;
        // 修正路径拼接逻辑
        const part = node.slug || node.id;
        validPath += (idx === 0 ? "" : "/") + part;
        breadcrumbs.push({ name: curName || node.id, path: validPath });
      } else {
        break;
      }
    }

    parentId = curr;
  }

  const nodes = await prisma.trainingNode.findMany({
    where: {
      parentId: parentId || null,
    },
    orderBy: {
      rank: "asc",
    },
    include: {
      contest: {
        select: {
          id: true,
          title: true,
          problems: {
            select: {
              displayId: true,
              problemId: true,
            },
            orderBy: {
              displayId: "asc",
            },
          },
        },
      },
    },
  });

  // 3. 获取用户的所有提交记录 (用于计算题目状态)
  const submissions = await prisma.submission.findMany({
    where: {
      globalUserId: globalUserId,
    },
    select: {
      contestId: true,
      problemId: true,
      verdict: true,
    },
  });

  // 构建提交状态 Map: contestId -> problemId -> status
  const statusMap = new Map<number, Map<number, number>>();
  submissions.forEach((sub) => {
    if (!sub.contestId) return;
    if (!statusMap.has(sub.contestId)) {
      statusMap.set(sub.contestId, new Map());
    }
    const problemMap = statusMap.get(sub.contestId)!;
    const currentStatus = problemMap.get(sub.problemId) || 0;

    let newStatus = 0;
    if (sub.verdict === "ACCEPTED") {
      newStatus = 2;
    } else {
      newStatus = 1;
    }
    if (newStatus > currentStatus) {
      problemMap.set(sub.problemId, newStatus);
    }
  });

  // 4. 构建文件系统结构
  const items: FileSystemItem[] = await Promise.all(
    nodes.map(async (node) => {
      if (node.type === "FOLDER") {
        const part = node.slug || node.id;
        const newPath = currentPath === "/" ? part : `${currentPath}/${part}`;

        // Folder aggregates include only contests the visitor has unlocked.
        const contestIdsResult: { contestId: number }[] =
          await prisma.$queryRaw`
           WITH RECURSIVE subtree AS (
            SELECT id, type, "contestId" FROM "training_nodes" WHERE id = ${node.id}
            UNION ALL
            SELECT t.id, t.type, t."contestId" FROM "training_nodes" t
            JOIN subtree s ON t."parentId" = s.id
          )
          SELECT "contestId" FROM subtree WHERE type = 'CONTEST' AND "contestId" IS NOT NULL;
        `;

        const visibleContests = await Promise.all(contestIdsResult.map(async (r) =>
          await hasContestAccess(r.contestId) ? r.contestId : null,
        ));
        const contestIds = visibleContests.filter((id): id is number => id !== null);

        let solvedCount = 0;
        let totalCount = 0;

        if (contestIds.length > 0) {
          const problems = await prisma.contestProblem.findMany({
            where: { contestId: { in: contestIds } },
            select: { contestId: true, problemId: true },
          });
          totalCount = problems.length;

          problems.forEach((p) => {
            const pMap = statusMap.get(p.contestId);
            if (pMap && pMap.get(p.problemId) === 2) {
              solvedCount++;
            }
          });
        }

        return {
          id: node.id,
          name: node.name,
          type: "folder",
          link: `/train?path=${newPath}`,
          contestCount: contestIds.length,
          solvedCount,
          totalCount,
        };
      } else {
        // Contest
        const contest = node.contest;
        if (!contest) return null;
        if (!(await hasContestAccess(contest.id))) {
          return {
            id: contest.id.toString(),
            name: `私有赛 #${contest.id} · 需验证密码`,
            type: "file",
            problems: [],
            solvedCount: 0,
            totalCount: 0,
            locked: true,
            link: `/contest/${contest.id}/access`,
          };
        }

        const problemMap = statusMap.get(contest.id);
        const problemsStatus = contest.problems.map((p) => {
          const statusVal = problemMap?.get(p.problemId) || 0;
          return {
            letter: p.displayId,
            status:
              statusVal === 2
                ? "passed"
                : statusVal === 1
                  ? "attempted"
                  : ("none" as "passed" | "attempted" | "none"),
          };
        });

        const solvedCount = problemsStatus.filter(
          (p) => p.status === "passed",
        ).length;

        return {
          id: contest.id.toString(),
          name: node.name || contest.title,
          type: "file",
          problems: problemsStatus,
          solvedCount,
          totalCount: contest.problems.length,
          link: `/contest/${contest.id}`,
        };
      }
    }),
  ).then((results) => results.filter(Boolean) as FileSystemItem[]);

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden min-h-150 flex flex-col">
          {/* 1. 地址栏 / 面包屑 */}
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center gap-2 text-sm">
            <div className="flex items-center gap-2 text-gray-500 hover:text-gray-700 transition-colors">
              <HomeIcon className="w-4 h-4" />
            </div>
            {breadcrumbs.map((crumb, idx) => (
              <div key={crumb.path} className="flex items-center gap-1">
                <span className="text-gray-400">/</span>
                <Link
                  href={crumb.path}
                  className={`px-2 py-1 rounded hover:bg-gray-200 transition-colors ${
                    idx === breadcrumbs.length - 1
                      ? "font-semibold text-gray-900"
                      : "text-gray-600"
                  }`}
                >
                  {crumb.name === "Root" ? "训练中心" : crumb.name}
                </Link>
              </div>
            ))}
          </div>

          {/* 2. 文件列表区域 */}
          <div className="flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <FolderIcon className="w-16 h-16 mb-4 opacity-20" />
                <p>此文件夹为空</p>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      类别
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-48"
                    >
                      #(比赛数量)
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-64"
                    >
                      #(过题情况)
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <Link
                          href={item.link}
                          className="flex items-center group cursor-pointer"
                        >
                          <div className="shrink-0 mr-3">
                            {item.type === "folder" ? (
                              <FolderIcon className="w-5 h-5 text-blue-500" />
                            ) : (
                              <DocumentIcon className="w-5 h-5 text-blue-400" />
                            )}
                          </div>
                          <div className="text-sm font-medium text-blue-600 group-hover:underline truncate max-w-lg">
                            {item.name}
                          </div>
                        </Link>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-500 font-mono">
                        {item.type === "folder" ? (
                          <span
                            className={
                              item.contestCount > 0
                                ? "text-gray-900 font-bold"
                                : ""
                            }
                          >
                            {item.contestCount}
                          </span>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-500">
                        {item.type === "file" && item.locked ? (
                          <span className="text-gray-400">需验证比赛密码</span>
                        ) : item.type === "file" ? (
                          <div className="flex items-center justify-end gap-2">
                            <div className="flex gap-0.5">
                              {item.problems.map((p) => (
                                <span
                                  key={p.letter}
                                  className={`
                                    w-5 h-5 flex items-center justify-center text-[10px] font-bold rounded-sm
                                    text-white
                                    ${
                                      p.status === "passed"
                                        ? "bg-green-600"
                                        : p.status === "attempted"
                                          ? "bg-red-600"
                                          : "bg-gray-400"
                                    }
                                  `}
                                  title={`Problem ${p.letter}: ${p.status}`}
                                >
                                  {p.letter}
                                </span>
                              ))}
                            </div>
                            <span className="font-mono text-xs ml-2">
                              <span className="text-red-600 font-bold">
                                {item.solvedCount}
                              </span>
                              <span className="text-gray-400">/</span>
                              <span>{item.totalCount}</span>
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end">
                            <span className="font-mono text-xs">
                              <span className="text-red-600 font-bold">
                                {item.solvedCount}
                              </span>
                              <span className="text-gray-400">/</span>
                              <span>{item.totalCount}</span>
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* 3. 底部状态栏 */}
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 flex justify-between">
            <span>{items.length} 个项目</span>
            <span>当前路径: {curName || "Root"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
