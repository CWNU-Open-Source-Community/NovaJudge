import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const script = await readFile(
    path.join(process.cwd(), "tools/contestant-cli/install-macos.sh"),
    "utf8",
  );
  return new Response(script, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'attachment; filename="install-submit-macos.sh"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
