import { getCurrentSuper } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertSameOriginJson, CliDeviceError } from "@/lib/cli-device-policy";
import { cliErrorResponse, cliJson, readCliJson } from "@/lib/cli-devices";
import { lockCliSettings } from "@/lib/cli-settings-lock";
import { assertCliEnabled, isCliEnabled } from "@/lib/cli-deployment";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const user = await getCurrentSuper();
  if (!user?.isGlobalAdmin) throw new CliDeviceError("Administrator sign-in is required.", 401, "UNAUTHORIZED");
}

async function settingsResponse() {
  const [settings, contests] = await Promise.all([
    prisma.cliSettings.findUnique({ where: { id: 1 }, select: { activeContestId: true } }),
    prisma.contest.findMany({ orderBy: { id: "desc" }, select: { id: true, title: true, status: true, type: true } }),
  ]);
  return cliJson({ enabled: isCliEnabled(), activeContestId: settings?.activeContestId ?? null, contests });
}

export async function GET() {
  try { await requireAdmin(); return await settingsResponse(); }
  catch (error) { return cliErrorResponse(error); }
}

export async function PUT(request: Request) {
  try {
    await requireAdmin();
    assertSameOriginJson(request);
    const { activeContestId } = await readCliJson(request);
    if (activeContestId !== null && (typeof activeContestId !== "number" || !Number.isSafeInteger(activeContestId) || activeContestId <= 0)) {
      throw new CliDeviceError("activeContestId must be a positive integer or null.", 400, "INVALID_CONTEST");
    }
    if (activeContestId !== null) assertCliEnabled();
    if (activeContestId !== null && !await prisma.contest.findUnique({ where: { id: activeContestId }, select: { id: true } })) {
      throw new CliDeviceError("Contest not found.", 404, "CONTEST_NOT_FOUND");
    }
    await prisma.$transaction(async (tx) => {
      await lockCliSettings(tx, "exclusive");
      const previous = await tx.cliSettings.findUnique({ where: { id: 1 } });
      await tx.cliSettings.upsert({ where: { id: 1 }, create: { id: 1, activeContestId }, update: { activeContestId } });
      if ((previous?.activeContestId ?? null) !== activeContestId) {
        // Switching away and later back must never reactivate old authorizations.
        await tx.cliDevice.updateMany({ where: { expiresAt: { gt: new Date() } }, data: { expiresAt: new Date() } });
      }
    });
    return await settingsResponse();
  } catch (error) { return cliErrorResponse(error); }
}
