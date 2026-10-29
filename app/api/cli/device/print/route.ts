import { cliErrorResponse, cliJson, getCliPrintContext, printCliDevice } from "@/lib/cli-devices";
import { assertCliEnabled } from "@/lib/cli-deployment";
import { readPrintFileJson } from "@/lib/print-file-policy";

export async function GET(request: Request) {
  try { return cliJson(await getCliPrintContext(request)); }
  catch (error) { return cliErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertCliEnabled();
    return cliJson(await printCliDevice(request, await readPrintFileJson(request)));
  } catch (error) { return cliErrorResponse(error); }
}
