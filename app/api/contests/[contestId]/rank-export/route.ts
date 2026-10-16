import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyAuth } from "@/lib/auth";
import { ContestRole, Verdict } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { contestAccessResponse } from "@/lib/contest-access";

type ContestExportConfig = {
  medal?: {
    mode?: "ratio" | "fixed";
    gold?: number;
    silver?: number;
    bronze?: number;
  };
};

type ProblemResult = {
  displayId: string;
  accepted: boolean;
  time: string;
  tries: number;
};

type TeamResult = {
  officialRank: number | "";
  displayRank: string;
  id: string;
  username: string;
  displayName: string;
  members: string;
  school: string;
  category: string;
  solved: number;
  penalty: number;
  medal: "Gold" | "Silver" | "Bronze" | "";
  awards: string[];
  problemResults: ProblemResult[];
};

function escapeXml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatContestTime(start: Date, submittedAt: Date) {
  const diffMs = submittedAt.getTime() - start.getTime();
  const hours = Math.floor(diffMs / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);
  const seconds = Math.floor((diffMs % 60000) / 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0",
  )}:${String(seconds).padStart(2, "0")}`;
}

function categoryLabel(category: string) {
  if (category === "1") return "Star";
  if (category === "2") return "Female";
  if (category === "GLOBAL") return "Global";
  return "Official";
}

function isStarTeam(category: string) {
  return category === "1";
}

function getMedalCounts(total: number, config: ContestExportConfig | null) {
  const medal = config?.medal || {};
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

async function canExportRank(contestId: number) {
  const cookieStore = await cookies();
  const adminToken = cookieStore.get("auth_token")?.value;
  const userToken = cookieStore.get("user_token")?.value;

  if (adminToken) {
    const payload = await verifyAuth(adminToken);
    if (payload?.isGlobalAdmin) return true;
  }

  if (userToken) {
    const payload = await verifyAuth(userToken);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { contestId: true, role: true },
    });
    return user?.contestId === contestId && user.role === ContestRole.ADMIN;
  }

  return false;
}

function cell(value: unknown, style = "Default") {
  const type = typeof value === "number" ? "Number" : "String";
  return `<Cell ss:StyleID="${style}"><Data ss:Type="${type}">${escapeXml(
    value,
  )}</Data></Cell>`;
}

function row(values: unknown[], style = "Default") {
  return `<Row>${values.map((value) => cell(value, style)).join("")}</Row>`;
}

function safeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "contest";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ contestId: string }> },
) {
  const { contestId } = await params;
  const cid = Number(contestId);

  if (!Number.isInteger(cid)) {
    return NextResponse.json({ error: "Invalid contestId" }, { status: 400 });
  }

  try {
    const denied = await contestAccessResponse(cid);
    if (denied) return denied;
    if (!(await canExportRank(cid))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const contest = await prisma.contest.findUnique({ where: { id: cid } });
    if (!contest) {
      return NextResponse.json({ error: "Contest not found" }, { status: 404 });
    }

    const [teams, contestProblems] = await Promise.all([
      prisma.user.findMany({
        where: { contestId: cid, role: ContestRole.TEAM },
        select: {
          id: true,
          username: true,
          displayName: true,
          members: true,
          school: true,
          category: true,
          submissions: {
            where: { contestId: cid, submittedAt: { lte: contest.endTime } },
            select: {
              displayId: true,
              problemId: true,
              verdict: true,
              submittedAt: true,
            },
            orderBy: { submittedAt: "asc" },
          },
        },
      }),
      prisma.contestProblem.findMany({
        where: { contestId: cid },
        select: { problemId: true, displayId: true },
        orderBy: { displayId: "asc" },
      }),
    ]);

    const firstBloodByProblem = new Map<number, string>();
    const allAccepted = await prisma.submission.findMany({
      where: {
        contestId: cid,
        verdict: Verdict.ACCEPTED,
        submittedAt: { lte: contest.endTime },
        user: {
          role: ContestRole.TEAM,
          OR: [{ category: null }, { category: { not: "1" } }],
        },
      },
      select: {
        problemId: true,
        submittedAt: true,
        userId: true,
      },
      orderBy: { submittedAt: "asc" },
    });

    for (const sub of allAccepted) {
      if (sub.userId && !firstBloodByProblem.has(sub.problemId)) {
        firstBloodByProblem.set(sub.problemId, sub.userId);
      }
    }

    const teamResults: TeamResult[] = teams.map((team) => {
      let solved = 0;
      let penalty = 0;

      const problemResults = contestProblems.map((cp) => {
        const submissions = team.submissions.filter(
          (sub) =>
            sub.problemId === cp.problemId &&
            sub.verdict !== Verdict.COMPILE_ERROR &&
            sub.verdict !== Verdict.SYSTEM_ERROR,
        );

        let accepted = false;
        let tries = 0;
        let time = "";

        for (const sub of submissions) {
          if (sub.verdict === Verdict.ACCEPTED) {
            accepted = true;
            time = formatContestTime(contest.startTime, sub.submittedAt);
            solved++;
            penalty +=
              Math.floor(
                (sub.submittedAt.getTime() - contest.startTime.getTime()) /
                  60000,
              ) +
              tries * 20;
            break;
          }
          tries++;
        }

        return {
          displayId: cp.displayId,
          accepted,
          time,
          tries,
        };
      });

      return {
        officialRank: "",
        displayRank: "",
        id: team.id,
        username: team.username,
        displayName: team.displayName || team.username,
        members: team.members || "",
        school: team.school || "",
        category: team.category || "0",
        solved,
        penalty,
        medal: "",
        awards: [],
        problemResults,
      };
    });

    teamResults.sort((a, b) => {
      if (a.solved !== b.solved) return b.solved - a.solved;
      if (a.penalty !== b.penalty) return a.penalty - b.penalty;
      return a.displayName.localeCompare(b.displayName);
    });

    let officialPosition = 0;
    let lastOfficial: TeamResult | null = null;
    for (const team of teamResults) {
      if (isStarTeam(team.category)) {
        team.displayRank = "*";
        continue;
      }

      officialPosition++;
      if (
        lastOfficial &&
        team.solved === lastOfficial.solved &&
        team.penalty === lastOfficial.penalty
      ) {
        team.officialRank = lastOfficial.officialRank;
      } else {
        team.officialRank = officialPosition;
      }
      team.displayRank = String(team.officialRank);
      lastOfficial = team;
    }

    const officialTeams = teamResults.filter((team) => !isStarTeam(team.category));
    const medalCounts = getMedalCounts(
      officialTeams.length,
      contest.config as ContestExportConfig,
    );

    officialTeams.forEach((team, index) => {
      if (index < medalCounts.gold) team.medal = "Gold";
      else if (index < medalCounts.gold + medalCounts.silver)
        team.medal = "Silver";
      else if (
        index <
        medalCounts.gold + medalCounts.silver + medalCounts.bronze
      )
        team.medal = "Bronze";
    });

    const awardRows: Array<[string, string, string, string, string]> = [];
    const addAward = (award: string, team: TeamResult, detail = "") => {
      team.awards.push(award);
      awardRows.push([
        award,
        team.displayName,
        team.school,
        team.displayRank,
        detail,
      ]);
    };

    const bestFemale = officialTeams.find((team) => team.category === "2");
    if (bestFemale) addAward("Best Female Team", bestFemale);

    const lastAccepted = allAccepted[allAccepted.length - 1];
    if (lastAccepted?.userId) {
      const team = officialTeams.find((item) => item.id === lastAccepted.userId);
      if (team) {
        addAward(
          "Tenacious Award",
          team,
          formatContestTime(contest.startTime, lastAccepted.submittedAt),
        );
      }
    }

    for (const cp of contestProblems) {
      const userId = firstBloodByProblem.get(cp.problemId);
      const team = officialTeams.find((item) => item.id === userId);
      if (team) addAward(`First Blood ${cp.displayId}`, team);
    }

    const bestBySchool = new Map<string, TeamResult>();
    for (const team of officialTeams) {
      if (!team.school || bestBySchool.has(team.school)) continue;
      bestBySchool.set(team.school, team);
    }
    const schoolWinners = Array.from(bestBySchool.values()).slice(0, 3);
    ["School Champion", "School Runner-up", "School Third Place"].forEach(
      (award, index) => {
        const team = schoolWinners[index];
        if (team) addAward(award, team, team.school);
      },
    );

    const headers = [
      "Rank",
      "Team",
      "Username",
      "School",
      "Members",
      "Category",
      "Solved",
      "Penalty",
      "Medal",
      "Awards",
      ...contestProblems.map((problem) => problem.displayId),
    ];

    const rankRows = [
      row(headers, "Header"),
      ...teamResults.map((team) => {
        const style =
          team.medal === "Gold"
            ? "Gold"
            : team.medal === "Silver"
              ? "Silver"
              : team.medal === "Bronze"
                ? "Bronze"
                : "Default";
        const problemCells = team.problemResults.map((result) => {
          if (result.accepted) {
            return result.tries > 0
              ? `${result.time} (-${result.tries})`
              : result.time;
          }
          return result.tries > 0 ? `-${result.tries}` : "";
        });

        return row(
          [
            team.displayRank,
            team.displayName,
            team.username,
            team.school,
            team.members,
            categoryLabel(team.category),
            team.solved,
            team.penalty,
            team.medal,
            team.awards.join("; "),
            ...problemCells,
          ],
          style,
        );
      }),
    ].join("");

    const awardsRows = [
      row(["Award", "Team", "School", "Rank", "Detail"], "Header"),
      ...awardRows.map((award) => row(award)),
    ].join("");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default"><Alignment ss:Vertical="Center"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9E2F3"/></Borders></Style>
  <Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#305496" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>
  <Style ss:ID="Gold"><Interior ss:Color="#FFF2CC" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Silver"><Interior ss:Color="#E7E6E6" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Bronze"><Interior ss:Color="#FCE4D6" ss:Pattern="Solid"/></Style>
 </Styles>
 <Worksheet ss:Name="Final Results">
  <Table>${rankRows}</Table>
 </Worksheet>
 <Worksheet ss:Name="Awards">
  <Table>${awardsRows}</Table>
 </Worksheet>
</Workbook>`;

    const filename = `${safeFilename(contest.title)}-final-results.xls`;
    return new Response(xml, {
      headers: {
        "Content-Type": "application/vnd.ms-excel; charset=utf-8",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(
          filename,
        )}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Export rank error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
