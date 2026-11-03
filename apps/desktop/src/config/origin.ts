export const APP_SCHEME = "app";
export const APP_HOST = "doriface";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The dev server becomes the trusted app origin, so it must be plain http on this machine's loopback. */
export function loopbackDevUrl(candidate: string): string {
  const url = URL.parse(candidate);
  if (url === null || url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(`refusing dev server ${JSON.stringify(candidate)}: only http on localhost, 127.0.0.1 or [::1]`);
  }
  return url.href;
}

/**
 * Compares scheme and host instead of `URL.origin`, which is the string "null" for custom schemes such as app:.
 */
export function isSameOrigin(candidate: string, origin: string): boolean {
  const url = URL.parse(candidate);
  const expected = URL.parse(origin);
  return url !== null && expected !== null && url.protocol === expected.protocol && url.host === expected.host;
}
