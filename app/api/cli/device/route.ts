import { cliErrorResponse, cliJson, createCliDevice, getCliDevice, readCliJson, revokeCliDevice } from "@/lib/cli-devices";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await readCliJson(request);
    return cliJson(await createCliDevice(request));
  } catch (error) { return cliErrorResponse(error); }
}

export async function GET(request: Request) {
  try { return cliJson(await getCliDevice(request)); }
  catch (error) { return cliErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try { return cliJson(await revokeCliDevice(request)); }
  catch (error) { return cliErrorResponse(error); }
}
