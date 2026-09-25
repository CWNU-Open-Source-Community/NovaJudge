import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyAuth } from "@/lib/auth";
import { cookies } from "next/headers";
import { promises as fs } from "fs";
import path from "path";
import JSZip from "jszip";
import { normalizeProblemSamples, type ProblemSample } from "@/lib/problem-samples";
import {
  ClariCategory,
  ContestRole,
  ContestStatus,
  ContestType,
  Verdict,
} from "@/lib/generated/prisma/client";

const UPLOAD_ROOT = path.join(process.cwd(), "uploads", "problems");

function getDataDir(problemId: number) {
  return path.join(UPLOAD_ROOT, problemId.toString(), "data");
}

function getAssetsDir(problemId: number) {
  return path.join(UPLOAD_ROOT, problemId.toString(), "assets");
}

interface ContestConfig {
  frozenDuration: number; // 封榜时长 (分钟)，0 表示不封榜
  unfreezeDelay: number; // 多少小时后自动解榜
  medal: {
    mode: "ratio" | "fixed";
    gold: number;
    silver: number;
    bronze: number;
  };
}

interface ContestData {
  id?: number;
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  type: ContestType;
  password?: string;
  status: ContestStatus;
  config?: ContestConfig;
}

interface UserData {
  id: string;
  username: string;
  password: string;
  plainPassword?: string;
  contestId: number;
  displayName?: string;
  members?: string;
  school?: string;
  seat?: string;
  coach?: string;
  category?: string;
  role: ContestRole;
}

interface ContestProblemData {
  id?: string;
  contestId: number;
  problemId: number;
  displayId: string;
  realTimeLimit?: number;
  realMemoryLimit?: number;
  color?: string;
}

interface SubmissionData {
  id: string;
  displayId: number;
  userId: string;
  problemId: number;
  language: string;
  code: string;
  codeLength: number;
  verdict: Verdict;
  timeUsed?: number;
  memoryUsed?: number;
  errorMessage?: string;
  passedTests: number;
  totalTests: number;
  submittedAt: string;
}

interface ClarificationData {
  id: number;
  contestId: number;
  displayId?: string;
  problemId?: number;
  userId?: string;
  title?: string;
  content: string;
  category: ClariCategory;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  replies: ReplyData[];
}

interface ReplyData {
  id: number;
  clarificationId: number;
  userId: string;
  content: string;
  createdAt: string;
}

interface BalloonData {
  id: number;
  submissionId: string;
  contestId: number;
  status: string;
  assignedToId?: string;
  createdAt: string;
  updatedAt: string;
}

interface ProblemData {
  id?: number;
  title: string;
  type: string;
  defaultTimeLimit: number;
  defaultMemoryLimit: number;
  sections: { title: string; content: string }[];
  samples: ProblemSample[];
  hint?: string;
  judgeConfig?: string;
}

export async function POST(request: Request) {
  try {
    // 1. 身份验证
    const token = (await cookies()).get("auth_token")?.value;
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = await verifyAuth(token);
    if (!payload.isGlobalAdmin) {
      return NextResponse.json(
        { error: "Only admin can perform this action" },
        { status: 403 },
      );
    }

    // 2. 解析表单数据
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file || !file.name.toLowerCase().endsWith(".zip")) {
      return NextResponse.json(
        { error: "Invalid file format" },
        { status: 400 },
      );
    }

    // 3. 读取ZIP文件
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    const importedContests: { id: number; title: string }[] = [];
    const errors: string[] = [];

    // 4. 遍历ZIP文件内容
    const zipEntries = Object.keys(zip.files);
    const contestDirs = new Set<string>();

    // 4.1 收集所有比赛目录（包含contest.json的目录）
    for (const entry of zipEntries) {
      if (entry.endsWith("/")) {
        const possibleContestDir = entry;
        const contestJsonEntry = zip.files[`${possibleContestDir}contest.json`];
        if (contestJsonEntry) {
          contestDirs.add(possibleContestDir);
        }
      }
    }

    // 4.2 处理每个比赛目录
    for (const contestDir of contestDirs) {
      try {
        // 4.2.1 读取比赛信息
        const contestJsonEntry = zip.files[`${contestDir}contest.json`];
        if (!contestJsonEntry) {
          continue;
        }

        const contestJsonContent = await contestJsonEntry.async("text");
        const contestData = JSON.parse(contestJsonContent) as ContestData;

        // 4.2.2 读取其他比赛相关数据
        let usersData: UserData[] = [];
        let contestProblemsData: ContestProblemData[] = [];
        let submissionsData: SubmissionData[] = [];
        let clarificationsData: ClarificationData[] = [];
        let balloonsData: BalloonData[] = [];

        const usersJsonEntry = zip.files[`${contestDir}users.json`];
        if (usersJsonEntry) {
          const usersJsonContent = await usersJsonEntry.async("text");
          usersData = JSON.parse(usersJsonContent);
        }

        const contestProblemsJsonEntry =
          zip.files[`${contestDir}contest_problems.json`];
        if (contestProblemsJsonEntry) {
          const contestProblemsJsonContent =
            await contestProblemsJsonEntry.async("text");
          contestProblemsData = JSON.parse(contestProblemsJsonContent);
        }

        const submissionsJsonEntry = zip.files[`${contestDir}submissions.json`];
        if (submissionsJsonEntry) {
          const submissionsJsonContent =
            await submissionsJsonEntry.async("text");
          submissionsData = JSON.parse(submissionsJsonContent);
        }

        const clarificationsJsonEntry =
          zip.files[`${contestDir}clarifications.json`];
        if (clarificationsJsonEntry) {
          const clarificationsJsonContent =
            await clarificationsJsonEntry.async("text");
          clarificationsData = JSON.parse(clarificationsJsonContent);
        }

        const balloonsJsonEntry = zip.files[`${contestDir}balloons.json`];
        if (balloonsJsonEntry) {
          const balloonsJsonContent = await balloonsJsonEntry.async("text");
          balloonsData = JSON.parse(balloonsJsonContent);
        }

        // 4.2.3 导入题目数据
        const problemsDir = `${contestDir}problems/`;
        const problemDirs = new Set<string>();
        const problemIdMap = new Map<number, number>(); // Old -> New

        for (const entry of zipEntries) {
          if (
            entry.startsWith(problemsDir) &&
            entry.endsWith("/") &&
            entry !== problemsDir
          ) {
            problemDirs.add(entry);
          }
        }

        for (const problemDir of problemDirs) {
          const problemJsonEntry = zip.files[`${problemDir}problem.json`];
          if (!problemJsonEntry) continue;

          const problemJsonContent = await problemJsonEntry.async("text");
          const problemData = JSON.parse(problemJsonContent) as ProblemData;

          // 1. 尝试查找同名题目 (复用)
          const existingProblem = await prisma.problem.findFirst({
            where: { title: problemData.title },
          });

          let problem;
          let isReused = false;

          if (existingProblem) {
            problem = existingProblem;
            isReused = true;
          } else {
            // 2. 创建新题目（自增ID）
            problem = await prisma.problem.create({
              data: {
                title: problemData.title,
                type: problemData.type,
                defaultTimeLimit: problemData.defaultTimeLimit,
                defaultMemoryLimit: problemData.defaultMemoryLimit,
                sections: problemData.sections,
                samples: normalizeProblemSamples(problemData.samples),
                hint: problemData.hint,
                judgeConfig: problemData.judgeConfig,
              },
            });
          }

          // 记录ID映射
          if (problemData.id) {
            problemIdMap.set(problemData.id, problem.id);
          }

          // 如果是复用题目，跳过后续的内容替换和文件导入
          if (isReused) {
            continue;
          }

          // 替换题面引用 (仅针对新创建的题目)
          if (problemData.id) {
            // 替换题面引用
            const oldIdStr = problemData.id.toString();
            const newIdStr = problem.id.toString();
            let contentChanged = false;
            let sections = problemData.sections;
            let hint = problemData.hint;

            // 替换 sections 中的图片路径
            const sectionsStr = JSON.stringify(sections);
            if (sectionsStr.includes(`/api/problems/${oldIdStr}/`)) {
              const newSectionsStr = sectionsStr.replaceAll(
                `/api/problems/${oldIdStr}/`,
                `/api/problems/${newIdStr}/`,
              );
              sections = JSON.parse(newSectionsStr);
              contentChanged = true;
            }

            // 替换 hint 中的图片路径
            if (hint && hint.includes(`/api/problems/${oldIdStr}/`)) {
              hint = hint.replaceAll(
                `/api/problems/${oldIdStr}/`,
                `/api/problems/${newIdStr}/`,
              );
              contentChanged = true;
            }

            // 如果有内容变更，更新题目
            if (contentChanged) {
              problem = await prisma.problem.update({
                where: { id: problem.id },
                data: {
                  sections,
                  hint,
                },
              });
            }
          }

          // 导入题目数据文件
          const dataDir = getDataDir(problem.id);
          await fs.mkdir(dataDir, { recursive: true });

          const dataEntries = zipEntries.filter(
            (entry) =>
              entry.startsWith(`${problemDir}data/`) && !entry.endsWith("/"),
          );

          for (const dataEntry of dataEntries) {
            const entry = zip.files[dataEntry];
            if (!entry) continue;

            const content = await entry.async("nodebuffer");
            const fileName = path.basename(dataEntry);
            await fs.writeFile(path.join(dataDir, fileName), content);
          }

          // 导入题目附件
          const assetsDir = getAssetsDir(problem.id);
          await fs.mkdir(assetsDir, { recursive: true });

          const assetEntries = zipEntries.filter(
            (entry) =>
              entry.startsWith(`${problemDir}assets/`) && !entry.endsWith("/"),
          );

          for (const assetEntry of assetEntries) {
            const entry = zip.files[assetEntry];
            if (!entry) continue;

            const content = await entry.async("nodebuffer");
            const fileName = path.basename(assetEntry);
            await fs.writeFile(path.join(assetsDir, fileName), content);
          }
        }

        // 4.2.4 创建新比赛（自增ID）
        const contest = await prisma.contest.create({
          data: {
            // id: contestData.id, // 不使用原ID
            title: contestData.title,
            description: contestData.description,
            startTime: new Date(contestData.startTime),
            endTime: new Date(contestData.endTime),
            type: contestData.type,
            password: contestData.password,
            status: contestData.status,
            config: contestData.config
              ? JSON.parse(JSON.stringify(contestData.config))
              : undefined,
          },
        });

        importedContests.push({ id: contest.id, title: contest.title });

        // 4.2.5 导入用户
        const userIdMap = new Map<string, string>(); // Old -> New (如果是UUID，其实可以保留，但为了安全重新生成)

        for (const userData of usersData) {
          // 创建新用户，ID自动生成
          const newUser = await prisma.user.create({
            data: {
              username: userData.username,
              password: userData.password,
              plainPassword: userData.plainPassword,
              contestId: contest.id,
              displayName: userData.displayName,
              members: userData.members,
              school: userData.school,
              seat: userData.seat,
              coach: userData.coach,
              category: userData.category,
              role: userData.role,
            },
          });
          userIdMap.set(userData.id, newUser.id);
        }

        // 4.2.6 导入比赛题目关联
        // 修复：先按 displayId 排序，确保插入顺序符合预期 (A, B, C...)
        contestProblemsData.sort((a, b) =>
          a.displayId.localeCompare(b.displayId),
        );

        for (const cpData of contestProblemsData) {
          // 映射 problemId
          const newProblemId = problemIdMap.get(cpData.problemId);
          if (!newProblemId) {
            // 如果找不到映射，可能是题目导入失败，跳过
            continue;
          }

          // 创建新关联
          await prisma.contestProblem.create({
            data: {
              contestId: contest.id,
              problemId: newProblemId,
              displayId: cpData.displayId,
              realTimeLimit: cpData.realTimeLimit,
              realMemoryLimit: cpData.realMemoryLimit,
              color: cpData.color,
            },
          });
        }

        // 4.2.7 导入提交记录
        const submissionIdMap = new Map<string, string>(); // Old -> New

        for (const submissionData of submissionsData) {
          const newUserId = userIdMap.get(submissionData.userId);
          const newProblemId = problemIdMap.get(submissionData.problemId);

          if (!newUserId || !newProblemId) {
            continue;
          }

          const newSubmission = await prisma.submission.create({
            data: {
              displayId: submissionData.displayId,
              userId: newUserId,
              problemId: newProblemId,
              contestId: contest.id,
              language: submissionData.language,
              code: submissionData.code,
              codeLength: submissionData.codeLength,
              verdict: submissionData.verdict,
              timeUsed: submissionData.timeUsed,
              memoryUsed: submissionData.memoryUsed,
              errorMessage: submissionData.errorMessage,
              passedTests: submissionData.passedTests,
              totalTests: submissionData.totalTests,
              submittedAt: new Date(submissionData.submittedAt),
            },
          });

          submissionIdMap.set(submissionData.id, newSubmission.id);
        }

        // 4.2.8 导入答疑
        const clarificationIdMap = new Map<number, number>();

        for (const clariData of clarificationsData) {
          const newUserId = clariData.userId
            ? userIdMap.get(clariData.userId)
            : null;
          // 如果有userId但映射失败，可能需要注意，但如果是Admin发的公告，userId可能为空
          // problemId 也需要映射
          const newProblemId = clariData.problemId
            ? problemIdMap.get(clariData.problemId)
            : null;

          const newClari = await prisma.clarification.create({
            data: {
              contestId: contest.id,
              displayId: clariData.displayId,
              problemId: newProblemId,
              userId: newUserId,
              title: clariData.title,
              content: clariData.content,
              category: clariData.category,
              isPublic: clariData.isPublic,
            },
          });
          clarificationIdMap.set(clariData.id, newClari.id);

          // 导入回复
          for (const replyData of clariData.replies) {
            const replyUserId = userIdMap.get(replyData.userId);
            if (!replyUserId) continue;

            await prisma.reply.create({
              data: {
                clarificationId: newClari.id,
                userId: replyUserId,
                content: replyData.content,
                createdAt: new Date(replyData.createdAt),
              },
            });
          }
        }

        // 4.2.9 导入气球
        for (const balloonData of balloonsData) {
          const newSubmissionId = submissionIdMap.get(balloonData.submissionId);
          if (!newSubmissionId) continue;

          const assignedToId = balloonData.assignedToId
            ? userIdMap.get(balloonData.assignedToId)
            : null;

          await prisma.balloon.create({
            data: {
              submissionId: newSubmissionId,
              contestId: contest.id,
              status: balloonData.status,
              assignedToId: assignedToId,
              createdAt: new Date(balloonData.createdAt),
              updatedAt: new Date(balloonData.updatedAt),
            },
          });
        }
      } catch (error) {
        errors.push(
          `Error processing ${contestDir}: ${(error as Error).message}`,
        );
      }
    }

    // 5. 返回导入结果
    return NextResponse.json({
      success: true,
      importedContests: importedContests.map((c) => c.title),
      errors,
    });
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
