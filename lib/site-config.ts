function safeHttpUrl(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? trimmed : "";
  } catch {
    return "";
  }
}

/** Server-side deployment branding; never expose the rest of process.env. */
export function getSiteConfig(env: Record<string, string | undefined> = process.env) {
  return {
    name: env.NOVAJUDGE_SITE_NAME?.trim() || "NovaJudge",
    description: env.NOVAJUDGE_SITE_DESCRIPTION?.trim() || "XCPC Online Judge",
    footer: env.NOVAJUDGE_FOOTER_TEXT?.trim() || "",
    externalLoginLabel: env.NOVAJUDGE_EXTERNAL_LOGIN_LABEL?.trim() || "",
    externalLoginUrl: safeHttpUrl(env.NOVAJUDGE_EXTERNAL_LOGIN_URL),
  };
}
