export const APP_SCHEME = "app";
export const APP_HOST = "doriface";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/**
 * Compares scheme and host instead of `URL.origin`, which is the string "null" for custom schemes such as app:.
 */
export function isSameOrigin(candidate: string, origin: string): boolean {
  const url = URL.parse(candidate);
  const expected = URL.parse(origin);
  return url !== null && expected !== null && url.protocol === expected.protocol && url.host === expected.host;
}
