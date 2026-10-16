import { NextRequest, NextResponse } from "next/server";
import { checkCCSAuth, unauthorizedResponse } from "@/lib/ccs/auth";
import { getProblems } from "@/lib/ccs/fetchers";

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

  const problems = await getProblems(id);
  return NextResponse.json(problems, { headers: { "Cache-Control": "private, no-store" } });
}
