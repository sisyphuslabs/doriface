/** Hosts (and their subdomains) the shell may open in the system browser. */
export const EXTERNAL_HOSTS = ["github.com", "omo.dev", "herdr.dev", "ghostty.org"] as const;

/** The normalized href of an allowlisted link, or undefined. Callers open this exact string. */
export function allowedExternal(candidate: string): string | undefined {
  const url = URL.parse(candidate);
  if (url === null || url.protocol !== "https:" || url.username !== "" || url.password !== "") return undefined;
  const allowed = EXTERNAL_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  return allowed ? url.href : undefined;
}

export function isAllowedExternal(candidate: string): boolean {
  return allowedExternal(candidate) !== undefined;
}
