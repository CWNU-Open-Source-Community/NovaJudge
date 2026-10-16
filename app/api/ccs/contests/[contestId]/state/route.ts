import { NextRequest, NextResponse } from "next/server";
import { checkCCSAuth, unauthorizedResponse } from "@/lib/ccs/auth";
import { getContestState } from "@/lib/ccs/fetchers";

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

  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid contest ID" }, { status: 400 });
  }

  const state = await getContestState(id);
  if (!state) {
    return NextResponse.json({ error: "Contest not found" }, { status: 404 });
  }

  return NextResponse.json(state, {
    headers: {
      "Cache-Control": "private, no-store",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
