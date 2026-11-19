import { Readable } from "node:stream";
import { getCurrentSuper } from "@/lib/auth";
import { contestAccessResponse } from "@/lib/contest-access";
import { contestSampleArchive, sampleDirectory } from "@/lib/contest-sample-archive";
import { openContestStatement } from "@/lib/contest-statements";
import { prisma } from "@/lib/prisma";

const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const missing = () => new Response(null, { status: 404, headers: privateHeaders });

function downloadHeaders(type: string, filename: string) {
  return { ...privateHeaders, "Content-Type": type,
    "Content-Disposition": `attachment; filename="${filename.replace(/[^a-zA-Z0-9._~-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}` };
}

export async function GET(request: Request, { params }: { params: Promise<{ contestId: string; file: string }> }) {
  const { contestId: rawId, file } = await params;
  if (file !== "statement.pdf" && file !== "samples.zip") return missing();
  const contestId = Number(rawId);
  const denied = await contestAccessResponse(contestId);
  if (denied) return denied;
  const contest = await prisma.contest.findUnique({
    where: { id: contestId }, select: { startTime: true, status: true },
  });
  if (!contest) return missing();
  if ((contest.status === "PENDING" || Date.now() < +contest.startTime) && !(await getCurrentSuper())?.isGlobalAdmin) return missing();

  const displayId = new URL(request.url).searchParams.get("problem");
  const wholeContest = displayId === null;
  const where = wholeContest ? { contestId } : { contestId, displayId };
  if (file === "statement.pdf") {
    const binding = wholeContest ? null : await prisma.contestProblem.findFirst({
      where, select: { id: true, problemId: true, displayId: true },
    });
    if (!wholeContest && !binding) return missing();
    const handle = await openContestStatement(contestId, binding?.id ?? null);
    if (!handle) return missing();
    const stem = binding ? "statement-" + sampleDirectory(binding.displayId, binding.problemId) : "problemset";
    const stream = Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>;
    return new Response(stream, { headers: downloadHeaders("application/pdf", stem + ".pdf") });
  }

  const problems = await prisma.contestProblem.findMany({
    where, orderBy: { displayId: "asc" },
    select: { displayId: true, problemId: true, problem: { select: { type: true, samples: true } } },
  });
  const archive = await contestSampleArchive(problems, wholeContest);
  if (!archive) return missing();
  const filename = wholeContest ? "samples.zip" : `samples-${sampleDirectory(problems[0].displayId, problems[0].problemId)}.zip`;
  return new Response(archive, { headers: downloadHeaders("application/zip", filename) });
}
