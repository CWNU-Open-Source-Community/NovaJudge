import JSZip from "jszip";
import { getCurrentUser } from "@/lib/auth";
import { contestAccessResponse } from "@/lib/contest-access";
import { contestLanguages } from "@/lib/contest-languages";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ contestId: string; id: string }> }) {
  const { contestId, id } = await params;
  const cid = Number(contestId);
  const denied = await contestAccessResponse(cid);
  if (denied) return denied;
  const team = await getCurrentUser();
  const headers = { "Cache-Control": "private, no-store" };
  if (team?.role !== "TEAM" || team.contestId !== cid) return new Response(null, { status: 403, headers });
  const submission = await prisma.submission.findFirst({
    where: { id, contestId: cid, userId: team.userId, globalUserId: null, virtualParticipationId: null },
    select: { code: true, language: true, displayId: true },
  });
  if (!submission) return new Response(null, { status: 404, headers });

  const zip = new JSZip();
  const language = contestLanguages.find(item => item.value === submission.language);
  zip.file(language?.sourceName ?? "source.txt", submission.code);
  return new Response(await zip.generateAsync({ type: "arraybuffer" }), {
    headers: { ...headers, "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="submission-${submission.displayId}.zip"` },
  });
}
