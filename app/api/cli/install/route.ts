import { readFile } from "node:fs/promises";
import path from "node:path";
import { assertCliEnabled } from "@/lib/cli-deployment";
import { cliErrorResponse } from "@/lib/cli-devices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try { assertCliEnabled(); }
  catch (error) { return cliErrorResponse(error); }
  const platform = new URL(request.url).searchParams.get("platform") ?? "macos";
  if (platform !== "macos" && platform !== "windows") {
    return Response.json({ error: "Unsupported platform." }, { status: 400 });
  }
  const filename = platform === "windows" ? "install-windows.ps1" : "install-macos.sh";
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
