export type Organization = { id: string; country?: string; name?: string; logoHash?: string };
export type OrganizationMap = Record<string, Organization>;

export type OrganizationEntry = {
  key: string;
  version: number;
  schools: string[];
  id: string;
  country: string;
  logoHash: string | null;
};

export type OrganizationFields = Pick<OrganizationEntry, "schools" | "id" | "country">;
export type OrganizationErrorCode = "name" | "country" | "duplicate" | "stale" | "image" | "size" | "legacy";

export class OrganizationInputError extends Error {
  constructor(readonly code: OrganizationErrorCode) { super(code); }
}

export function organizationFields(name: string, aliases: string, id: string, country: string): OrganizationFields {
  name = name.trim();
  if (!name) throw new OrganizationInputError("name");
  country = country.trim().toUpperCase();
  if (country && !/^[A-Z]{2}$/.test(country)) throw new OrganizationInputError("country");
  const schools = [...new Set([name, ...aliases.split(/\r?\n/).map(alias => alias.trim()).filter(Boolean)])];
  return { schools, id: id.trim(), country };
}

export function indexOrganizations(entries: OrganizationEntry[]): OrganizationMap {
  const directory: OrganizationMap = Object.create(null);
  for (const entry of entries) {
    const organization = {
      id: entry.id, name: entry.schools[0], country: entry.country || undefined, logoHash: entry.logoHash || undefined,
    };
    for (const school of entry.schools) directory[school] = organization;
  }
  return directory;
}

export function matchOrganization(directory: OrganizationMap, school: string | null) {
  const name = school?.trim();
  return name && Object.hasOwn(directory, name) ? directory[name] : undefined;
}

export function organizationLogoUrl(hash: string) {
  return `/api/organization-logos/${hash}`;
}
