/** An existing deployment's preference is retained; new sites opt in. */
export function externalLoginEnabled(
  setting: { allowExternalLogin: boolean } | null,
  authUrl = process.env.EXTERNAL_AUTH_URL,
) {
  if (!setting?.allowExternalLogin || !authUrl?.trim()) return false;
  try {
    const url = new URL(authUrl);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
