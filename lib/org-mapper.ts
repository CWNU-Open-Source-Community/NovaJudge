import fs from "fs/promises";
import path from "path";

let cachedOrgMap: Record<string, string> | null = null;

export async function getOrganizationMap(): Promise<Record<string, string>> {
  if (cachedOrgMap) {
    return cachedOrgMap;
  }

  try {
    const filePath = process.env.NOVAJUDGE_ORG_MAP_PATH?.trim()
      ? path.resolve(process.env.NOVAJUDGE_ORG_MAP_PATH)
      : path.join(process.cwd(), "config", "org-map.json");

    const fileContent = await fs.readFile(filePath, "utf-8");

    const parsed: unknown = JSON.parse(fileContent);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
        Object.values(parsed).some((value) => typeof value !== "string")) {
      throw new Error("Organization mapping must be an object of string values.");
    }
    cachedOrgMap = parsed as Record<string, string>;
    return cachedOrgMap!;
  } catch (error) {
    console.error(
      "Unable to read organization mapping. Check NOVAJUDGE_ORG_MAP_PATH or config/org-map.json:",
      error,
    );

    return {};
  }
}
