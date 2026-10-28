import type { Prisma } from "@/lib/generated/prisma/client";

const CLI_LOCK_NAMESPACE = 73921;
const CLI_SETTINGS_LOCK = 1;

// All callers hold this transaction-scoped lock only while using that same
// transaction client. Shared submissions/approvals serialize against switches.
export async function lockCliSettings(tx: Prisma.TransactionClient, mode: "shared" | "exclusive") {
  if (mode === "shared") {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${CLI_LOCK_NAMESPACE}::integer, ${CLI_SETTINGS_LOCK}::integer)`;
  } else {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CLI_LOCK_NAMESPACE}::integer, ${CLI_SETTINGS_LOCK}::integer)`;
  }
}
