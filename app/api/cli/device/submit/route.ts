import { cliErrorResponse, cliJson, readCliJson, submitCliDevice } from "@/lib/cli-devices";

export async function POST(request: Request) {
  try { return cliJson(await submitCliDevice(request, await readCliJson(request))); }
  catch (error) { return cliErrorResponse(error); }
}
