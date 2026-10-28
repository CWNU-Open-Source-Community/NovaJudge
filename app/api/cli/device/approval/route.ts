import { cliApprovalDetails, cliErrorResponse, cliJson } from "@/lib/cli-devices";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try { return cliJson(await cliApprovalDetails(new URL(request.url).searchParams.get("code"))); }
  catch (error) { return cliErrorResponse(error); }
}
