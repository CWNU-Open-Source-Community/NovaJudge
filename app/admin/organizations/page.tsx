import { requireSuperAdmin } from "@/lib/admin-auth";
import { getOrganizationEntries } from "@/lib/org-mapper";
import { prisma } from "@/lib/prisma";
import OrganizationManager from "./OrganizationManager";

export default async function OrganizationsPage() {
  await requireSuperAdmin();
  const [entries, schools] = await Promise.all([
    getOrganizationEntries(),
    prisma.user.findMany({
      where: { role: "TEAM", school: { not: null } },
      select: { school: true }, distinct: ["school"], orderBy: { school: "asc" },
    }),
  ]);
  return <OrganizationManager entries={entries} schools={schools.flatMap(({ school }) => school?.trim() ? [school.trim()] : [])} />;
}
