import { NextRequest, NextResponse } from "next/server";
import { checkCCSAuth, unauthorizedResponse } from "@/lib/ccs/auth";
import { getOrganizations } from "@/lib/ccs/fetchers";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ contestId: string }> }
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

  const organizations = await getOrganizations(id);
  return NextResponse.json(organizations, { headers: { "Cache-Control": "private, no-store" } });
}
