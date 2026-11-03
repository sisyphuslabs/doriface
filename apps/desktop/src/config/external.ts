/** Hosts (and their subdomains) the shell may open in the system browser. */
export const EXTERNAL_HOSTS = ["github.com", "omo.dev", "herdr.dev", "ghostty.org"] as const;

export function isAllowedExternal(candidate: string): boolean {
  const url = URL.parse(candidate);
  if (url === null || url.protocol !== "https:" || url.username !== "" || url.password !== "") return false;
  return EXTERNAL_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}
