import { readFile } from "node:fs/promises";
import path from "node:path";
import { assertCliEnabled } from "@/lib/cli-deployment";
import { cliErrorResponse } from "@/lib/cli-devices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try { assertCliEnabled(); }
  catch (error) { return cliErrorResponse(error); }
  const query = new URL(request.url).searchParams;
  const platform = query.get("platform") ?? "macos";
  const filename = query.get("file") ?? (platform === "windows" ? "submit.ps1" : "submit-macos");
  const allowed = platform === "macos" ? ["submit-macos"]
    : platform === "windows" ? ["submit.ps1", "submit.cmd", "submit.bat"] : [];
  if (!allowed.includes(filename)) {
    return Response.json({ error: "Unsupported platform or client file." }, { status: 400 });
  }
  const script = await readFile(
    path.join(process.cwd(), "tools/contestant-cli", filename),
    "utf8",
  );
  return new Response(script, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
