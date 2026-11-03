/** The exact hosts the shell may open in the system browser; subdomains are not included. */
export const EXTERNAL_HOSTS = ["github.com", "omo.dev", "herdr.dev", "ghostty.org"] as const;

/** The normalized href of an allowlisted link, or undefined. Callers open this exact string. */
export function allowedExternal(candidate: string): string | undefined {
  const url = URL.parse(candidate);
  if (url === null || url.protocol !== "https:" || url.username !== "" || url.password !== "") return undefined;
  return EXTERNAL_HOSTS.some((host) => url.hostname === host) ? url.href : undefined;
}

export function isAllowedExternal(candidate: string): boolean {
  return allowedExternal(candidate) !== undefined;
}
