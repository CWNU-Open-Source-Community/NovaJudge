/** Server-side deployment branding; never expose the rest of process.env. */
export function getSiteConfig() {
  return {
    name: process.env.NOVAJUDGE_SITE_NAME?.trim() || "NovaJudge",
    description: process.env.NOVAJUDGE_SITE_DESCRIPTION?.trim() || "XCPC Online Judge",
    footer: process.env.NOVAJUDGE_FOOTER_TEXT?.trim() || "",
  };
}
