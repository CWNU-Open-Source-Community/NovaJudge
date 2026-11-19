"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/admin-auth";
import { changeOrganization } from "@/lib/org-mapper";
import { readOrganizationLogo } from "@/lib/organization-logo";
import { organizationFields, OrganizationInputError } from "@/lib/organizations";

function refreshOrganizations() {
  revalidatePath("/admin/organizations");
  revalidatePath("/contest/[contestId]/rank", "page");
  revalidatePath("/contest/[contestId]", "page");
}

export async function saveOrganization(form: FormData) {
  await requireSuperAdmin();
  try {
    const text = (key: string) => String(form.get(key) ?? "");
    const key = text("key");
    const fields = organizationFields(text("name"), text("aliases"), text("id"), text("country"));
    const upload = form.get("logo");
    if (typeof upload === "string") throw new OrganizationInputError("image");
    const logo = upload?.name ? await readOrganizationLogo(upload) : form.has("removeLogo") ? null : undefined;
    await changeOrganization(key ? { key, version: Number(text("version")) } : null, fields, logo);
  } catch (error) {
    if (error instanceof OrganizationInputError) return { error: error.code };
    throw error;
  }
  refreshOrganizations();
  return { error: null };
}

export async function deleteOrganization(key: string, version: number) {
  await requireSuperAdmin();
  try {
    await changeOrganization({ key, version }, null);
  } catch (error) {
    if (error instanceof OrganizationInputError) return { error: error.code };
    throw error;
  }
  refreshOrganizations();
  return { error: null };
}
