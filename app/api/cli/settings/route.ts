import { cliErrorResponse, cliJson, publicCliSettings } from "@/lib/cli-devices";

export const dynamic = "force-dynamic";

export async function GET() {
  try { return cliJson(await publicCliSettings()); }
  catch (error) { return cliErrorResponse(error); }
}
