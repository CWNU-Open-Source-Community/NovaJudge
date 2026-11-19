import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis"; // 【新增】引入 redis
import { NextRequest, NextResponse } from "next/server";
import { contestAccessResponse } from "@/lib/contest-access";
import { getCurrentSuper, getJwtSecretKey } from "@/lib/auth";
import { contestAccessCookieName, verifyContestAccessToken } from "@/lib/contest-access-token";
import { Verdict } from "@/lib/generated/prisma/enums";
import {
  canViewSubmissionTestDetails,
  hideSubmissionProgress,
} from "@/lib/submission-visibility";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const submissionId = (await params).id;
  const target = await prisma.submission.findUnique({
    where: { id: submissionId }, select: { contestId: true },
  });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (target.contestId !== null) {
    const denied = await contestAccessResponse(target.contestId);
    if (denied) return denied;
  }
  const encoder = new TextEncoder();
  const isGlobalAdmin = !!(await getCurrentSuper())?.isGlobalAdmin;
  const accessToken = target.contestId === null ? "" :
    request.cookies.get(contestAccessCookieName(target.contestId))?.value || "";
  const canViewTestDetails = await canViewSubmissionTestDetails(submissionId);

  const redisKey = `submission:${submissionId}:progress`;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  function stopPolling() {
    stopped = true;
    clearTimeout(timer);
    if (onAbort) request.signal.removeEventListener("abort", onAbort);
  }
  const stream = new ReadableStream({
    start(controller) {
      const finish = () => {
        if (stopped) return;
        stopPolling();
        controller.close();
      };
      const sendEvent = (data: {
        verdict: Verdict;
        passedTests: number;
        totalTests: number;
      }) => {
        if (stopped) return;
        const payload = canViewTestDetails
          ? data
          : hideSubmissionProgress(data);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
        );
      };

      let lastKnownVerdict: Verdict | null = null;
      let lastKnownPassed: number = -1;

      const checkStatus = async () => {
        try {
          const freshSub = await prisma.submission.findUnique({
            where: { id: submissionId },
            select: {
              verdict: true,
              passedTests: true,
              totalTests: true,
              contest: { select: { id: true, type: true, password: true } },
            },
          });

          if (!freshSub) return true;
          if (freshSub.contest?.type === "PRIVATE" && !isGlobalAdmin &&
              !(await verifyContestAccessToken(accessToken, freshSub.contest, getJwtSecretKey()))) {
            return true;
          }

          if (freshSub.verdict === Verdict.JUDGING) {
            const redisDataStr = await redis.get(redisKey);
            if (redisDataStr) {
              try {
                // 解析 JSON: { verdict, passedTests, totalTests, finished }
                const redisData = JSON.parse(redisDataStr as string);

                // 使用 Redis 中的实时数据覆盖 DB 数据
                if (typeof redisData.passedTests === "number") {
                  freshSub.passedTests = redisData.passedTests;
                }
                if (typeof redisData.totalTests === "number") {
                  freshSub.totalTests = redisData.totalTests;
                }
              } catch (e) {
                console.error("Failed to parse redis progress json", e);
              }
            }
          }

          // 3. 对比是否有变化
          if (
            freshSub.verdict !== lastKnownVerdict ||
            freshSub.passedTests !== lastKnownPassed
          ) {
            sendEvent({
              verdict: freshSub.verdict,
              passedTests: freshSub.passedTests,
              totalTests: freshSub.totalTests,
            });
            lastKnownVerdict = freshSub.verdict;
            lastKnownPassed = freshSub.passedTests;
          }

          // 4. 判断是否结束
          if (
            freshSub.verdict !== Verdict.PENDING &&
            freshSub.verdict !== Verdict.JUDGING
          ) {
            return true; // 结束
          }
          return false; // 继续
        } catch (error) {
          console.error("SSE Error:", error);
          return true;
        }
      };

      const poll = async () => {
        const done = await checkStatus();
        if (stopped) return;
        if (done) finish();
        else timer = setTimeout(poll, 200);
      };
      onAbort = finish;
      if (request.signal.aborted) return finish();
      request.signal.addEventListener("abort", onAbort, { once: true });
      void poll();
    },
    cancel: stopPolling,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "private, no-store",
      Connection: "keep-alive",
    },
  });
}
