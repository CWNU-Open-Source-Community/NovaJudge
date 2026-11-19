import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "./generated/prisma/client";
import { prisma } from "./prisma";
import {
  indexOrganizations, OrganizationInputError,
  type OrganizationEntry, type OrganizationFields, type OrganizationMap,
} from "./organizations";

export type { Organization } from "./organizations";

export function parseOrganizationMap(json: string): OrganizationMap {
  const entries: unknown = JSON.parse(json);
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) throw new Error("Expected an organization map.");
  const organizations: OrganizationMap = Object.create(null);
  for (const [school, entry] of Object.entries(entries)) {
    if (typeof entry === "string") {
      organizations[school] = { id: entry };
    } else if (entry && typeof entry === "object" && typeof entry.id === "string" &&
      (entry.country === undefined || (typeof entry.country === "string" && /^[a-z]{2}$/i.test(entry.country)))) {
      organizations[school] = { id: entry.id, country: entry.country?.toUpperCase() };
    } else {
      throw new Error(`Invalid organization entry for ${school}.`);
    }
  }
  return organizations;
}

async function legacyEntries() {
  const externalFile = process.env.NOVAJUDGE_ORG_MAP_PATH?.trim();
  let content: string;
  try {
    content = externalFile
      ? await readFile(/* turbopackIgnore: true */ externalFile, "utf8")
      : await readFile(path.join(process.cwd(), "config", "org-map.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const directory = parseOrganizationMap(content);
  const groups = new Map<string, OrganizationEntry>();
  for (const [name, { id, country }] of Object.entries(directory)) {
    const school = name.trim();
    if (!school) continue;
    const group = id ? `id:${id}` : `school:${school}`;
    const existing = groups.get(group);
    if (existing) {
      if (!existing.schools.includes(school)) existing.schools.push(school);
      if (!existing.country && country) existing.country = country;
    } else {
      const key = createHash("sha256").update(group).digest("hex");
      groups.set(group, { key, version: 0, schools: [school], id, country: country || "", logoHash: null });
    }
  }
  return [...groups.values()];
}

export async function getOrganizationEntries(db: Pick<Prisma.TransactionClient, "organizationDirectory"> = prisma, importing = false) {
  const row = await db.organizationDirectory.findUnique({ where: { id: 1 }, select: { entries: true } });
  if (row) return row.entries as unknown as OrganizationEntry[];
  try {
    return await legacyEntries();
  } catch (error) {
    console.error("Unable to read the legacy organization map.", error);
    if (importing) throw new OrganizationInputError("legacy");
    return [];
  }
}

export async function getOrganizationDirectory(): Promise<OrganizationMap> {
  return indexOrganizations(await getOrganizationEntries());
}

type OrganizationEdit = { key: string; version: number };
type Logo = { hash: string; data: Uint8Array<ArrayBuffer> };

// A missing directory uses the deployment's original JSON until the first admin save.
// Keep the new directory and the image bytes in one transaction, including on first use.
export async function changeOrganization(edit: OrganizationEdit | null, fields: OrganizationFields | null, logo?: Logo | null) {
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73921, 2)`;
    const entries = await getOrganizationEntries(tx, true);
    const current = edit ? entries.find(entry => entry.key === edit.key) : undefined;
    if (edit && (!current || current.version !== edit.version)) throw new OrganizationInputError("stale");
    const next = entries.filter(entry => entry !== current);
    if (fields) {
      const schools = new Set(fields.schools);
      const affiliation = fields.id || fields.schools[0];
      if (next.some(entry => (entry.id || entry.schools[0]) === affiliation || entry.schools.some(school => schools.has(school)))) {
        throw new OrganizationInputError("duplicate");
      }
      if (logo) {
        await tx.organizationLogo.upsert({ where: { hash: logo.hash }, create: logo, update: {} });
      }
      next.push({
        ...fields, key: current?.key ?? randomUUID(), version: (current?.version ?? 0) + 1,
        logoHash: logo === undefined ? current?.logoHash ?? null : logo?.hash ?? null,
      });
    }
    await tx.organizationDirectory.upsert({
      where: { id: 1 }, create: { id: 1, entries: next }, update: { entries: next },
    });
    if (current?.logoHash && !next.some(entry => entry.logoHash === current.logoHash)) {
      await tx.organizationLogo.deleteMany({ where: { hash: current.logoHash } });
    }
  });
}
