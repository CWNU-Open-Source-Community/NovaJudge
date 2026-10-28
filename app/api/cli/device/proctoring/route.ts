import { CliDeviceError, cliErrorResponse, cliJson, createProctoringCliDevice, readCliJson } from "@/lib/cli-devices";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) {
      throw new CliDeviceError("Use an application/json request.", 415, "JSON_REQUIRED");
    }
    await readCliJson(request);
    return cliJson(await createProctoringCliDevice(request));
  } catch (error) { return cliErrorResponse(error); }
}
