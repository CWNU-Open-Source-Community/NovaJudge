import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyAuth } from "@/lib/auth";
import { cookies } from "next/headers";
import { promises as fs } from "fs";
import path from "path";
import JSZip from "jszip";

const UPLOAD_ROOT = path.join(process.cwd(), "uploads", "problems");

function getDataDir(problemId: number) {
  return path.join(UPLOAD_ROOT, problemId.toString(), "data");
}

function getAssetsDir(problemId: number) {
  return path.join(UPLOAD_ROOT, problemId.toString(), "assets");
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

    // 2. 解析请求参数
    const body = await request.json();
    const { contestIds, includeData = true } = body;

    if (!Array.isArray(contestIds) || contestIds.length === 0) {
      return NextResponse.json(
        { error: "Invalid contestIds" },
        { status: 400 },
      );
    }

    // 3. 创建ZIP文件
    const zip = new JSZip();

    // 4. 处理每个比赛
    for (const contestId of contestIds) {
      // 4.1 获取比赛信息
      const contest = await prisma.contest.findUnique({
        where: { id: contestId },
        include: {
          users: true,
          problems: {
            include: {
              problem: true,
            },
          },
          submissions: {
            include: {
              user: true,
              problem: true,
            },
          },
          clarifications: {
            include: {
              user: true,
              replies: {
                include: {
                  user: true,
                },
              },
            },
          },
          balloons: {
            include: {
              submission: true,
              assignedTo: true,
            },
          },
        },
      });

      if (!contest) {
        continue;
      }

      const contestDir = zip.folder(
        `contest_${contestId}_${contest.title.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")}`,
      );
      if (!contestDir) continue;

      // 4.2 导出比赛基本信息
      contestDir.file(
        "contest.json",
        JSON.stringify(
          {
            id: contest.id,
            title: contest.title,
            description: contest.description,
            startTime: contest.startTime,
            endTime: contest.endTime,
            type: contest.type,
            password: contest.password,
            status: contest.status,
            config: contest.config,
          },
          null,
          2,
        ),
      );

      // 4.3 导出比赛用户
      contestDir.file("users.json", JSON.stringify(contest.users, null, 2));

      // 4.4 导出比赛题目关联
      contestDir.file(
        "contest_problems.json",
        JSON.stringify(
          contest.problems.map((cp) => ({
            id: cp.id,
            contestId: cp.contestId,
            problemId: cp.problemId,
            displayId: cp.displayId,
            realTimeLimit: cp.realTimeLimit,
            realMemoryLimit: cp.realMemoryLimit,
            color: cp.color,
          })),
          null,
          2,
        ),
      );

      // 4.5 导出提交记录
      contestDir.file(
        "submissions.json",
        JSON.stringify(
          contest.submissions.map((sub) => ({
            id: sub.id,
            displayId: sub.displayId,
            userId: sub.userId,
            problemId: sub.problemId,
            language: sub.language,
            code: sub.code,
            codeLength: sub.codeLength,
            verdict: sub.verdict,
            timeUsed: sub.timeUsed,
            memoryUsed: sub.memoryUsed,
            errorMessage: sub.errorMessage,
            passedTests: sub.passedTests,
            totalTests: sub.totalTests,
            submittedAt: sub.submittedAt,
          })),
          null,
          2,
        ),
      );

      // 4.6 导出答疑
      contestDir.file(
        "clarifications.json",
        JSON.stringify(
          contest.clarifications.map((clari) => ({
            id: clari.id,
            contestId: clari.contestId,
            displayId: clari.displayId,
            problemId: clari.problemId,
            userId: clari.userId,
            title: clari.title,
            content: clari.content,
            category: clari.category,
            isPublic: clari.isPublic,
            createdAt: clari.createdAt,
            updatedAt: clari.updatedAt,
            replies: clari.replies.map((reply) => ({
              id: reply.id,
              clarificationId: reply.clarificationId,
              userId: reply.userId,
              content: reply.content,
              createdAt: reply.createdAt,
            })),
          })),
          null,
          2,
        ),
      );

      // 4.7 导出气球
      contestDir.file(
        "balloons.json",
        JSON.stringify(
          contest.balloons.map((balloon) => ({
            id: balloon.id,
            submissionId: balloon.submissionId,
            contestId: balloon.contestId,
            status: balloon.status,
            assignedToId: balloon.assignedToId,
            createdAt: balloon.createdAt,
            updatedAt: balloon.updatedAt,
          })),
          null,
          2,
        ),
      );

      // 4.8 导出题目数据
      const problemsDir = contestDir.folder("problems");
      if (problemsDir) {
        for (const contestProblem of contest.problems) {
          const problem = contestProblem.problem;
          if (!problem) continue;

          const problemDir = problemsDir.folder(
            `problem_${problem.id}_${problem.title.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")}`,
          );
          if (!problemDir) continue;

          // 导出题目基本信息
          problemDir.file(
            "problem.json",
            JSON.stringify(
              {
                id: problem.id,
                title: problem.title,
                type: problem.type,
                defaultTimeLimit: problem.defaultTimeLimit,
                defaultMemoryLimit: problem.defaultMemoryLimit,
                sections: problem.sections,
                samples: problem.samples,
                hint: problem.hint,
                judgeConfig: problem.judgeConfig,
              },
              null,
              2,
            ),
          );

          // 导出题目数据文件
          if (includeData) {
            const dataDir = getDataDir(problem.id);
            try {
              await fs.access(dataDir);
              const dataFiles = await fs.readdir(dataDir);
              const problemDataDir = problemDir.folder("data");
              if (problemDataDir) {
                for (const file of dataFiles) {
                  const filePath = path.join(dataDir, file);
                  const content = await fs.readFile(filePath);
                  problemDataDir.file(file, content);
                }
              }
            } catch (error) {
              console.error(
                `Error reading data directory for problem ${problem.id}:`,
                error,
              );
            }
          }

          // 导出题目附件
          const assetsDir = getAssetsDir(problem.id);
          try {
            await fs.access(assetsDir);
            const assetFiles = await fs.readdir(assetsDir);
            const problemAssetsDir = problemDir.folder("assets");
            if (problemAssetsDir) {
              for (const file of assetFiles) {
                const filePath = path.join(assetsDir, file);
                const content = await fs.readFile(filePath);
                problemAssetsDir.file(file, content);
              }
            }
          } catch (error) {
            console.error(
              `Error reading assets directory for problem ${problem.id}:`,
              error,
            );
          }
        }
      }
    }

    // 5. 生成ZIP文件
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    // 6. 返回ZIP文件
    return new Response(new Uint8Array(zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="contests_${Date.now()}.zip"`,
        "Content-Length": zipBuffer.length.toString(),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
