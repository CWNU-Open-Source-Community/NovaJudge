import { NextResponse } from "next/server";
import { getCurrentSuper, getCurrentUser } from "@/lib/auth";
import { getContestManager } from "@/lib/contest-management-auth";
import { getPendingClarifications } from "@/lib/clarification-notifications";
import { prisma } from "@/lib/prisma";

const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  try {
    const administrator = await getCurrentSuper();
    if (administrator?.isGlobalAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
    }
    const session = await getCurrentUser();
    if (!session || session instanceof Error || !session.contestId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
    }

    // Recheck the current database role and private-contest access. Never
    // accept a contest scope supplied by the client or rely on a stale JWT role.
    const manager = await getContestManager(session.contestId);
    if (!manager || manager.isGlobalAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
    }

    const feed = await getPendingClarifications(prisma, session.contestId);
    return NextResponse.json({ ...feed, viewerKey: manager.key }, { headers });
  } catch (error) {
    console.error("Failed to load clarification notifications:", error);
    return NextResponse.json(
      { error: "Failed to load clarification notifications" },
      { status: 500, headers },
    );
  }
}
