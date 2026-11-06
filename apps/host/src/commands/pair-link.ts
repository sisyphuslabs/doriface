import { buildPairingDeepLink, buildPairingUrl, type PairingTarget } from "@doriface/crypto";

/** The link a pairing hands out, and what opens it: a web page at the given origin, or the desktop app. */
export type PairingArtifact =
  | { readonly url: string; readonly opens: "web" }
  | { readonly url: string; readonly opens: "desktop" };

/**
 * `<web origin>/pair#…` when the operator names a web origin, and the desktop app's `doriface://pair#…` otherwise:
 * without a deployed web app, a default web origin would be a link that opens nothing (#594).
 */
export function pairingArtifact(target: PairingTarget, webOrigin: string | undefined): PairingArtifact {
  return webOrigin === undefined
    ? { url: buildPairingDeepLink(target), opens: "desktop" }
    : { url: buildPairingUrl({ ...target, webOrigin }), opens: "web" };
}
