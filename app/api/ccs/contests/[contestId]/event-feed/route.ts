import { NextRequest, NextResponse } from "next/server";
import { checkCCSAuth, unauthorizedResponse } from "@/lib/ccs/auth";
import {
  getContest,
  getContestState,
  getTeams,
  getProblems,
  getSubmissions,
  getJudgements,
  getRuns,
  getLanguages,
  getGroups,
  getOrganizations,
  getSubmissionStates,
  formatSubmission,
  formatJudgement,
  formatRun,
} from "@/lib/ccs/fetchers";
import { toCCSVerdict, toISO8601, getRelativeTime } from "@/lib/ccs/utils";
import { Verdict } from "@/lib/generated/prisma/enums";
import { getFeedAwards } from "@/lib/awards";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";

function createEvent(
  type: string,
  id: string | number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  op: "create" | "update" | "delete" = "create",
) {
  return (
    JSON.stringify({
      type,
      id: String(id),
      op,
      data,
    }) + "\n"
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ contestId: string }> },
) {
  const isAuthorized = await checkCCSAuth(req);
  if (!isAuthorized) {
    return unauthorizedResponse();
  }

  const { contestId } = await params;
  const id = parseInt(contestId, 10);
  const isStatic = req.nextUrl.searchParams.get("stream") === "false";
  const includeRuns = req.nextUrl.searchParams.get("runs") !== "false";

  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid contest ID" }, { status: 400 });
  }

  // Fetch initial data
  const contest = await getContest(id);
  if (!contest) {
    return NextResponse.json({ error: "Contest not found" }, { status: 404 });
  }

  // Track state for polling
  let lastState = await getContestState(id);
  const knownSubmissions = new Map<
    string,
    { verdict: string; submittedAt: Date; teamId: string; passedTests: number }
  >();

  // Initial fetch of full data
  const teams = await getTeams(id);
  const organizations = await getOrganizations(id);
  const groups = await getGroups(id);
  const problems = await getProblems(id);
  const languages = await getLanguages(id);
  const submissions = await getSubmissions(id);
  const judgements = await getJudgements(id);
  const runs = await getRuns(id);
  // Populate known submissions
  const initialStates = await getSubmissionStates(id);
  initialStates.forEach((s) => {
    knownSubmissions.set(s.id, {
      verdict: s.verdict,
      submittedAt: s.submittedAt,
      teamId: s.user?.username || s.userId || "",
      passedTests: s.passedTests || 0,
    });
  });

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (str: string) => {
        controller.enqueue(new TextEncoder().encode(str));
      };

      // 1. Contest
      if (contest) {
        enqueue(createEvent("contests", contest.id, contest));
      }

      // 2. State
      if (lastState) {
        enqueue(createEvent("state", contest.id, lastState));
      }

      // 3. Judgement Types (Static)
      const judgementTypes = [
        { id: "AC", name: "Correct", penalty: false, solved: true },
        { id: "WA", name: "Wrong Answer", penalty: true, solved: false },
        {
          id: "TLE",
          name: "Time Limit Exceeded",
          penalty: true,
          solved: false,
        },
        {
          id: "MLE",
          name: "Memory Limit Exceeded",
          penalty: true,
          solved: false,
        },
        { id: "RTE", name: "Runtime Error", penalty: true, solved: false },
        { id: "CE", name: "Compile Error", penalty: false, solved: false },
        { id: "PE", name: "Presentation Error", penalty: true, solved: false },
        { id: "SE", name: "System Error", penalty: false, solved: false },
      ];
      judgementTypes.forEach((jt) => {
        enqueue(createEvent("judgement-types", jt.id, jt));
      });

      // 4. Languages
      if (languages) {
        languages.forEach((l) => {
          enqueue(createEvent("languages", l.id, l));
        });
      }

      // 5. Problems
      problems.forEach((p) => {
        enqueue(createEvent("problems", p.id, p));
      });

      // 6. Groups
      if (groups) {
        groups.forEach((g) => {
          enqueue(createEvent("groups", g.id, g));
        });
      }

      // 7. Organizations
      if (organizations) {
        organizations.forEach((o) => {
          enqueue(createEvent("organizations", o.id, o));
        });
      }

      // 8. Teams
      teams.forEach((t) => {
        enqueue(createEvent("teams", t.id, t));
      });

      // 8.5 Awards（奖项事件：金银铜 + 自定义奖项，供 ICPC Tools resolver 滚榜使用）
      // 奖项基于最终榜单计算，仅在管理员设置并启用后输出。
      // 格式与 ICPC Tools award 工具一致：无 op 字段、带 parameters，
      // 金银铜各含一条 display_mode="list" 的副本。
      const awards = await getFeedAwards(id);
      awards.forEach((a) => {
        const data: Record<string, unknown> = {
          id: a.id,
          citation: a.citation,
          team_ids: a.team_ids,
          parameters: {},
        };
        if (a.display_mode) data.display_mode = a.display_mode;
        enqueue(JSON.stringify({ type: "awards", id: a.id, data }) + "\n");
      });

      // 9. Submissions
      if (submissions) {
        submissions.forEach((s) => {
          enqueue(createEvent("submissions", s.id, s));
        });
      }

      // 10. Judgements
      if (judgements) {
        judgements.forEach((j) => {
          if (j) {
            enqueue(createEvent("judgements", j.id, j));
          }
        });
      }

      // 11. Runs
      if (runs && includeRuns) {
        runs.forEach((r) => {
          enqueue(createEvent("runs", r.id, r));
        });
      }

      // 如果是静态导出，到这里就结束流，不要进入轮询
      if (isStatic) {
        controller.close();
        return;
      }

      // Polling Loop
      const checkInterval = 2000; // Check every 2 seconds
      // console.log(`[EventFeed] Starting polling loop for contest ${id}`);

      try {
        while (true) {
          if (req.signal.aborted) {
            console.log(`[EventFeed] Client disconnected for contest ${id}`);
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, checkInterval));

          // A. Check Contest State
          const newState = await getContestState(id);
          if (
            newState &&
            JSON.stringify(newState) !== JSON.stringify(lastState)
          ) {
            enqueue(createEvent("state", contest.id, newState, "update"));
            lastState = newState;
          }

          // B. Check Submissions / Runs / Judgements
          const currentStates = await getSubmissionStates(id);
          // console.log(
          //   `[EventFeed] Polling... Submissions count: ${currentStates.length}`,
          // );

          // Use contest start time from the initial fetch.
          // Note: If contest start time changes, we might need to refetch contest info,
          // but usually that's rare during a contest.
          const contestStartTime = new Date(contest.start_time);

          for (const sub of currentStates) {
            const known = knownSubmissions.get(sub.id);

            // Redis Key: submission:{id}:progress
            // We'll check Redis for real-time progress if it's JUDGING
            let redisPassed = 0;
            if (sub.verdict === "JUDGING") {
              const redisKey = `submission:${sub.id}:progress`;
              const redisData = await redis.get(redisKey);
              if (redisData) {
                try {
                  const progress = JSON.parse(redisData);
                  if (progress && typeof progress.passedTests === "number") {
                    redisPassed = progress.passedTests;
                  }
                } catch (e) {
                  // ignore parse error
                  console.log(e);
                }
              }
            }

            const isFinished =
              sub.verdict !== "PENDING" && sub.verdict !== "JUDGING";
            const verdictCode = toCCSVerdict(sub.verdict as Verdict);

            // Priority: DB passedTests > Redis passedTests (if DB is behind) > 0
            // Actually, DB is updated only sometimes?
            // Judge updates DB periodically but Redis is faster.
            // Let's take the max of DB and Redis to be safe.
            const dbPassed = sub.passedTests || 0;
            const passedTests = Math.max(dbPassed, redisPassed);

            const startTime = sub.submittedAt;

            if (!known) {
              // console.log(`[EventFeed] New submission detected: ${sub.id}`);
              // ==========================================
              // 1. New Submission (First time seen)
              // ==========================================
              const teamId = sub.user?.username || sub.userId || "";
              const passedTests = sub.passedTests || 0;

              knownSubmissions.set(sub.id, {
                verdict: sub.verdict,
                submittedAt: startTime,
                teamId,
                passedTests,
              });

              // Event 1: Create Submission
              const submissionData = formatSubmission(sub, contestStartTime);
              enqueue(
                createEvent("submissions", sub.id, submissionData, "create"),
              );

              // Event 2: Create Judgement (Start Pending)
              const judgementData = formatJudgement(sub, contestStartTime);
              enqueue(
                createEvent("judgements", sub.id, judgementData, "create"),
              );

              // Event 3: Emit existing runs (if any)
              for (let i = 1; i <= passedTests; i++) {
                const runTime = new Date(startTime.getTime() + i * 100);
                const runData = formatRun(
                  sub,
                  i,
                  contestStartTime,
                  "AC",
                  runTime,
                );
                enqueue(createEvent("runs", runData.id, runData, "create"));
              }

              // If finished on first sight (rare but possible), emit remaining events
              let totalVirtualRuns = passedTests;
              if (isFinished && verdictCode && verdictCode !== "AC") {
                totalVirtualRuns = passedTests + 1;
                const runTime = new Date(
                  startTime.getTime() + totalVirtualRuns * 100,
                );
                const runData = formatRun(
                  sub,
                  totalVirtualRuns,
                  contestStartTime,
                  verdictCode,
                  runTime,
                );
                enqueue(createEvent("runs", runData.id, runData, "create"));
              }

              if (isFinished) {
                const realWorldDuration =
                  totalVirtualRuns * 100 + (sub.timeUsed || 0);
                const endTime = new Date(
                  startTime.getTime() + Math.max(1000, realWorldDuration),
                );
                const finalJudgementData = formatJudgement(
                  sub,
                  contestStartTime,
                  verdictCode,
                  endTime,
                );
                enqueue(
                  createEvent(
                    "judgements",
                    sub.id,
                    finalJudgementData,
                    "update",
                  ),
                );
              }
            } else if (
              known.verdict !== sub.verdict ||
              passedTests > known.passedTests
            ) {
              // console.log(
              //   `[EventFeed] Update detected for ${sub.id}: Verdict ${known.verdict}->${sub.verdict}, Tests ${known.passedTests}->${passedTests}`,
              // );
              // ==========================================
              // 2. Status Update (Progressing or Finished)
              // ==========================================
              const oldPassed = known.passedTests || 0;

              // Update known state
              knownSubmissions.set(sub.id, {
                verdict: sub.verdict,
                submittedAt: startTime,
                teamId: known.teamId,
                passedTests,
              });

              // Emit incremental runs
              for (let i = oldPassed + 1; i <= passedTests; i++) {
                const runTime = new Date(startTime.getTime() + i * 100);
                const runData = {
                  id: `${sub.id}-${i}`,
                  judgement_id: sub.id,
                  ordinal: i,
                  judgement_type_id: "AC",
                  time: toISO8601(runTime),
                  contest_time: getRelativeTime(contestStartTime, runTime),
                  team_id: known.teamId,
                  problem_id: sub.problemId.toString(),
                  language_id: sub.language,
                };
                enqueue(createEvent("runs", runData.id, runData, "create"));

                // IMPORTANT: Update Judgement end_time to match the latest run
                // This forces ICPC Live to "refresh" the judgement state and redraw the progress bar
                // We keep judgement_type_id as null because it's still JUDGING
                const judgementData = {
                  id: sub.id,
                  submission_id: sub.id,
                  judgement_type_id: null,
                  start_time: toISO8601(startTime),
                  end_time: null, // Still null because not finished? Or update end_time?
                  // Actually, ICPC Live might need 'end_time' to remain null to stay in queue.
                  // But maybe we need to poke it?
                  // Let's try sending an 'update' to the Judgement with same null end_time.
                  // Some systems need a poke on the parent object.
                  start_contest_time: getRelativeTime(
                    contestStartTime,
                    startTime,
                  ),
                  end_contest_time: null,
                };
                enqueue(
                  createEvent("judgements", sub.id, judgementData, "update"),
                );

                await new Promise((resolve) => setTimeout(resolve, 30));
              }

              // If finished, handle failing run and judgement update
              let totalVirtualRuns = passedTests;
              if (isFinished && verdictCode && verdictCode !== "AC") {
                totalVirtualRuns = passedTests + 1;
                const runTime = new Date(
                  startTime.getTime() + totalVirtualRuns * 100,
                );
                const runData = {
                  id: `${sub.id}-${totalVirtualRuns}`,
                  judgement_id: sub.id,
                  ordinal: totalVirtualRuns,
                  judgement_type_id: verdictCode,
                  time: toISO8601(runTime),
                  contest_time: getRelativeTime(contestStartTime, runTime),
                  team_id: known.teamId,
                  problem_id: sub.problemId.toString(),
                  language_id: sub.language,
                };
                enqueue(createEvent("runs", runData.id, runData, "create"));
                await new Promise((resolve) => setTimeout(resolve, 50));
              }

              if (isFinished) {
                const realWorldDuration =
                  totalVirtualRuns * 100 + (sub.timeUsed || 0);
                const endTime = new Date(
                  startTime.getTime() + Math.max(1000, realWorldDuration),
                );
                const judgementData = {
                  id: sub.id,
                  submission_id: sub.id,
                  judgement_type_id: verdictCode,
                  start_time: toISO8601(startTime),
                  end_time: toISO8601(endTime),
                  start_contest_time: getRelativeTime(
                    contestStartTime,
                    startTime,
                  ),
                  end_contest_time: getRelativeTime(contestStartTime, endTime),
                };
                enqueue(
                  createEvent("judgements", sub.id, judgementData, "update"),
                );
              }
            }
          }
        }
      } catch (error) {
        console.error("Event feed stream error or disconnect:", error);
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Encoding": "none",
      "X-Accel-Buffering": "no",
    },
  });
}
