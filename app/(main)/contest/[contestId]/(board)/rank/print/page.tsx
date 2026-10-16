import { requireContestAccess } from "@/lib/contest-access";
import { ContestConfig } from "@/app/(main)/page";
import { ContestRole, Verdict } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import PrintButton from "./PrintButton";
import { Metadata } from "next/types";

type RankProblemCell = {
  accepted: boolean;
  firstBlood: boolean;
  time: string;
  tries: number;
};

type PrintTeam = {
  id: string;
  rank: number | string;
  medal: "Gold" | "Silver" | "Bronze" | "";
  username: string;
  displayName: string | null;
  members: string | null;
  school: string | null;
  category: string | null;
  solved: number;
  penalty: number;
  problems: Array<RankProblemCell | null>;
};

interface Props {
  params: Promise<{ contestId: string }>;
}

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
    title: `排行榜 - ${contest.title}`,
  };
}

function formatTime(startTime: number, submissionTime: number) {
  const diffMs = submissionTime - startTime;
  const minutes = Math.floor(diffMs / 60000);
  return `${minutes}`;
}

function getMedalCounts(total: number, config: ContestConfig | null) {
  const medal = config?.medal || {
    mode: "ratio" as const,
    gold: 0,
    silver: 0,
    bronze: 0,
  };
  const mode = medal.mode || "ratio";
  const gold = Math.max(0, Number(medal.gold || 0));
  const silver = Math.max(0, Number(medal.silver || 0));
  const bronze = Math.max(0, Number(medal.bronze || 0));

  if (mode === "fixed") {
    return {
      gold: Math.min(total, Math.floor(gold)),
      silver: Math.min(total, Math.floor(silver)),
      bronze: Math.min(total, Math.floor(bronze)),
    };
  }

  return {
    gold: Math.min(total, Math.ceil((total * gold) / 100)),
    silver: Math.min(total, Math.ceil((total * silver) / 100)),
    bronze: Math.min(total, Math.ceil((total * bronze) / 100)),
  };
}

export default async function RankPrintPage({ params }: Props) {
  const contestId = Number((await params).contestId);
  await requireContestAccess(contestId);
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
  });

  if (!contest) notFound();

  const contestProblems = await prisma.contestProblem.findMany({
    where: { contestId },
    select: {
      problemId: true,
      displayId: true,
      color: true,
    },
    orderBy: { displayId: "asc" },
  });
  const config = contest.config as ContestConfig | null;
  const frozenDuration = config?.frozenDuration ?? 0;
  const freezeTime =
    frozenDuration > 0
      ? contest.endTime.getTime() - frozenDuration * 60 * 1000
      : null;
  const shouldShowFrozenState =
    frozenDuration !== 0 && freezeTime !== null && Date.now() >= freezeTime;
  const submissionEndTime =
    shouldShowFrozenState && freezeTime
      ? new Date(Math.min(freezeTime, contest.endTime.getTime()))
      : contest.endTime;

  const teams = await prisma.user.findMany({
    where: {
      contestId,
      role: ContestRole.TEAM,
    },
    select: {
      id: true,
      username: true,
      displayName: true,
      members: true,
      school: true,
      category: true,
      submissions: {
        where: {
          contestId,
          virtualParticipationId: null,
          submittedAt: {
            gte: contest.startTime,
            ...(shouldShowFrozenState ? { lt: submissionEndTime } : {}),
            ...(!shouldShowFrozenState ? { lte: submissionEndTime } : {}),
          },
          verdict: {
            notIn: [Verdict.COMPILE_ERROR, Verdict.SYSTEM_ERROR],
          },
        },
        select: {
          id: true,
          problemId: true,
          verdict: true,
          submittedAt: true,
        },
        orderBy: { submittedAt: "asc" },
      },
    },
  });

  const startTimeMs = contest.startTime.getTime();
  const firstBloodMap = new Map<number, string>();
  for (const cp of contestProblems) {
    const first = teams
      .flatMap((team) => team.submissions)
      .filter(
        (submission) =>
          submission.problemId === cp.problemId &&
          submission.verdict === Verdict.ACCEPTED,
      )
      .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime())[0];
    if (first) firstBloodMap.set(cp.problemId, first.id);
  }

  const rankings: PrintTeam[] = teams.map((team) => {
    let solved = 0;
    let penalty = 0;

    const problems = contestProblems.map((cp) => {
      const submissions = team.submissions.filter(
        (submission) => submission.problemId === cp.problemId,
      );
      if (submissions.length === 0) return null;

      let wrongBeforeAccepted = 0;
      for (const submission of submissions) {
        if (submission.verdict === Verdict.ACCEPTED) {
          const acceptedTimeMs = submission.submittedAt.getTime() - startTimeMs;
          const acceptedPenalty =
            Math.floor(acceptedTimeMs / 60000) + wrongBeforeAccepted * 20;
          solved++;
          penalty += acceptedPenalty;

          return {
            accepted: true,
            firstBlood: firstBloodMap.get(cp.problemId) === submission.id,
            time: formatTime(startTimeMs, submission.submittedAt.getTime()),
            tries: wrongBeforeAccepted,
          };
        }

        wrongBeforeAccepted++;
      }

      return {
        accepted: false,
        firstBlood: false,
        time: "",
        tries: wrongBeforeAccepted,
      };
    });

    return {
      rank: 0,
      medal: "",
      id: team.id,
      username: team.username,
      displayName: team.displayName,
      members: team.members,
      school: team.school,
      category: team.category,
      solved,
      penalty,
      problems,
    };
  });

  rankings.sort((a, b) => {
    if (a.solved !== b.solved) return b.solved - a.solved;
    return a.penalty - b.penalty;
  });

  for (let i = 0; i < rankings.length; i++) {
    if (rankings[i].category === "1") {
      rankings[i].rank = "*";
    } else if (
      i > 0 &&
      rankings[i].solved === rankings[i - 1].solved &&
      rankings[i].penalty === rankings[i - 1].penalty
    ) {
      rankings[i].rank = rankings[i - 1].rank;
    } else {
      rankings[i].rank = i + 1;
    }
  }

  const officialTeams = rankings.filter((team) => team.category !== "1");
  const medalCounts = getMedalCounts(officialTeams.length, config);
  officialTeams.forEach((team, index) => {
    if (index < medalCounts.gold) team.medal = "Gold";
    else if (index < medalCounts.gold + medalCounts.silver)
      team.medal = "Silver";
    else if (index < medalCounts.gold + medalCounts.silver + medalCounts.bronze)
      team.medal = "Bronze";
  });

  const problemCount = Math.max(contestProblems.length, 1);
  const pageWidthMm = 186;
  const rankWidthMm = 7;
  const teamWidthMm = 30;
  const solvedWidthMm = 9;
  const penaltyWidthMm = 11;
  const problemAreaWidthMm =
    pageWidthMm - rankWidthMm - teamWidthMm - solvedWidthMm - penaltyWidthMm;
  const problemWidthMm = problemAreaWidthMm / problemCount;

  return (
    <main className="rank-print-document">
      <style>{`
        @page { size: A4 portrait; margin: 8mm; }

        .rank-print-document,
        .rank-print-document * {
          box-sizing: border-box;
          print-color-adjust: exact;
          -webkit-print-color-adjust: exact;
        }

        html,
        body {
          background: #fff !important;
        }

        .rank-print-document {
          width: ${pageWidthMm}mm;
          margin: 0 auto;
          color: #111827;
          background: #fff;
          box-shadow: none !important;
          font-family: "Times New Roman", "PingFang SC", "Microsoft YaHei", serif;
        }

        .rank-print-actions {
          display: flex;
          justify-content: flex-end;
          margin-bottom: 10px;
        }

        .rank-print-header {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 12px;
          border-bottom: 2px solid #111827;
          padding-bottom: 6px;
          margin-bottom: 8px;
        }

        .rank-print-header h1 {
          margin: 0;
          font-size: 15pt;
          line-height: 1.15;
          max-width: 150mm;
        }

        .rank-print-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 4px;
          color: #475569;
          font-size: 7pt;
        }

        .rank-print-time {
          color: #475569;
          font-size: 7pt;
          text-align: right;
          white-space: nowrap;
          width: 28mm;
          overflow: hidden;
        }

        .rank-print-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          font-size: 5.4pt;
        }

        .rank-print-table thead th {
          border-bottom: 1.5px solid #64748b;
          padding: 2px 1px;
          color: #111827;
          font-size: 5.8pt;
          white-space: nowrap;
        }

        .rank-print-table tbody tr:nth-child(even) td {
          background: #eaf2fb;
        }

        .rank-print-table td {
          border-bottom: 1px solid #ffffff;
          padding: 1.5px 1px;
          text-align: center;
          vertical-align: middle;
          line-height: 1.08;
        }

        .rank-col-rank { width: ${rankWidthMm}mm; }
        .rank-col-team { width: ${teamWidthMm}mm; }
        .rank-col-solved { width: ${solvedWidthMm}mm; }
        .rank-col-penalty { width: ${penaltyWidthMm}mm; }
        .rank-col-problem { width: ${problemWidthMm}mm; }

        .rank-cell-rank {
          font-size: 7pt;
          font-weight: 800;
        }

        .rank-medal-gold { background: #fde047 !important; color: #422006; }
        .rank-medal-silver { background: #cbd5e1 !important; color: #0f172a; }
        .rank-medal-bronze { background: #b45309 !important; color: #fff; }

        .rank-team {
          text-align: center;
          overflow: hidden;
        }

        .rank-team strong {
          display: block;
          color: #1d4ed8;
          font-size: 5.5pt;
          line-height: 1.05;
        }

        .rank-team span {
          display: block;
          color: #0f172a;
          font-size: 5pt;
          line-height: 1.05;
        }

        .rank-score {
          font-size: 7pt;
          font-weight: 800;
        }

        .rank-problem-cell {
          min-height: 8mm;
          color: #fff;
          font-weight: 800;
          word-break: break-word;
          overflow: hidden;
        }

        .rank-problem-empty {
          background: transparent !important;
          color: transparent;
        }

        .rank-problem-accepted { background: #4caf50 !important; }
        .rank-problem-first { background: #1b5e20 !important; }
        .rank-problem-wrong { background: #d32f2f !important; }

        .rank-problem-cell small {
          display: block;
          font-size: 4.6pt;
          opacity: 0.82;
        }

        @media print {
          .rank-print-actions { display: none !important; }
          html,
          body,
          body > div,
          body > div > div {
            background: #fff !important;
            box-shadow: none !important;
          }

          body {
            margin: 0 !important;
          }

          .rank-print-document {
            box-shadow: none !important;
          }
        }
      `}</style>

      <div className="rank-print-actions no-print">
        <PrintButton />
      </div>

      <header className="rank-print-header">
        <div>
          <h1>{contest.title}</h1>
          <div className="rank-print-meta">
            <span>ID: {contest.id}</span>
            <span>Type: {contest.type}</span>
            <span>Status: {contest.status}</span>
          </div>
        </div>
        <div className="rank-print-time">
          Generated
          <br />
          {new Date().toLocaleString("zh-CN")}
        </div>
      </header>

      <table className="rank-print-table">
        <colgroup>
          <col className="rank-col-rank" />
          <col className="rank-col-team" />
          <col className="rank-col-solved" />
          <col className="rank-col-penalty" />
          {contestProblems.map((problem) => (
            <col key={problem.problemId} className="rank-col-problem" />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Team</th>
            <th>Solved</th>
            <th>Penalty</th>
            {contestProblems.map((problem, index) => (
              <th key={problem.problemId}>{String.fromCharCode(65 + index)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rankings.map((team) => (
            <tr key={team.id}>
              <td
                className={`rank-cell-rank ${
                  team.medal === "Gold"
                    ? "rank-medal-gold"
                    : team.medal === "Silver"
                      ? "rank-medal-silver"
                      : team.medal === "Bronze"
                        ? "rank-medal-bronze"
                        : ""
                }`}
              >
                {team.rank}
              </td>
              <td className="rank-team">
                <strong>
                  {team.category === "1"
                    ? "* "
                    : team.category === "2"
                      ? "F "
                      : ""}
                  {team.displayName || team.username}
                </strong>
                <span>{team.members || team.username}</span>
                {team.school && <span>{team.school}</span>}
              </td>
              <td className="rank-score">{team.solved}</td>
              <td className="rank-score">{team.penalty}</td>
              {team.problems.map((problem, index) => {
                if (!problem) {
                  return (
                    <td
                      key={index}
                      className="rank-problem-cell rank-problem-empty"
                    />
                  );
                }

                const className = problem.accepted
                  ? problem.firstBlood
                    ? "rank-problem-first"
                    : "rank-problem-accepted"
                  : "rank-problem-wrong";

                return (
                  <td key={index} className={`rank-problem-cell ${className}`}>
                    {problem.accepted ? problem.time : `-${problem.tries}`}
                    {problem.accepted && problem.tries > 0 && (
                      <small>(-{problem.tries})</small>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
