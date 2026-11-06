import {
  buildPairingDeepLink,
  buildPairingUrl,
  DEFAULT_PAIRING_WEB_ORIGIN,
  type PairingTarget,
} from "@doriface/crypto";

/** The link a pairing hands out, and what opens it: a web page at the given origin, or the desktop app. */
export type PairingArtifact =
  | { readonly url: string; readonly opens: "web" }
  | { readonly url: string; readonly opens: "desktop" };

/**
 * `<web origin>/pair#…` when the operator names a web origin, and the desktop app's `doriface://pair#…` otherwise:
 * the link is what another computer opens, and its desktop app takes the deep link.
 */
export function pairingArtifact(target: PairingTarget, webOrigin: string | undefined): PairingArtifact {
  return webOrigin === undefined
    ? { url: buildPairingDeepLink(target), opens: "desktop" }
    : { url: buildPairingUrl({ ...target, webOrigin }), opens: "web" };
}

/**
 * What a QR code encodes, for a phone's camera: always a web page, `<web origin>/pair#…`, on the operator's origin or
 * the hosted web app (#700), since a phone has no app that opens `doriface://`. Same fragment as the link.
 */
export function phonePairingLink(target: PairingTarget, webOrigin: string | undefined): string {
  return buildPairingUrl({ ...target, webOrigin: webOrigin ?? DEFAULT_PAIRING_WEB_ORIGIN });
}
