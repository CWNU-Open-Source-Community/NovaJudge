import { NextResponse } from "next/server";
import { getJwtSecretKey } from "@/lib/auth";
import { verifyContestAccessToken } from "@/lib/contest-access-token";
import { prisma } from "@/lib/prisma";

export async function cliContestAccessResponse(req: Request, contestId: number) {
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    select: { id: true, type: true, password: true },
  });
  const headers = { "Cache-Control": "private, no-store" };
  if (!contest) {
    return NextResponse.json({ error: "Contest not found" }, { status: 404, headers });
  }
  if (contest.type === "PUBLIC") return null;
  const token = req.headers.get("x-contest-access-token") || "";
  if (await verifyContestAccessToken(token, contest, getJwtSecretKey())) return null;
  return NextResponse.json({
    error: "Contest password required or expired; log in again with the contest password",
    code: "CONTEST_PASSWORD_REQUIRED",
  }, { status: 403, headers });
}
