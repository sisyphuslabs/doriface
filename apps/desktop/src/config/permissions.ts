import { isSameOrigin } from "./origin.ts";

/** The only permission the app origin may hold: copying terminal text to the clipboard. */
export const GRANTABLE_PERMISSIONS: ReadonlySet<string> = new Set(["clipboard-sanitized-write"]);

export function isGrantable(permission: string, requestingUrl: string, origin: string): boolean {
  return GRANTABLE_PERMISSIONS.has(permission) && isSameOrigin(requestingUrl, origin);
}
