import { assertSameOriginJson } from "@/lib/cli-device-policy";
import { approveCliDevice, cliErrorResponse, cliJson, readCliJson } from "@/lib/cli-devices";

export async function POST(request: Request) {
  try {
    assertSameOriginJson(request);
    return cliJson(await approveCliDevice(request, await readCliJson(request)));
  } catch (error) { return cliErrorResponse(error); }
}
