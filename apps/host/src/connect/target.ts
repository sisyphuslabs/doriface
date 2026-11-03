import { normalizePairingCode, type PairingLink, parsePairingUrl } from "@doriface/crypto";
import { HOST_ID_PATTERN } from "@doriface/relay-client";

export type ConnectTarget =
  | { readonly kind: "host"; readonly hostId: string }
  | { readonly kind: "link"; readonly link: PairingLink }
  | { readonly kind: "code"; readonly code: string };

function codeOf(text: string): string | undefined {
  try {
    return normalizePairingCode(text);
  } catch {
    return undefined;
  }
}

export function parseTarget(text: string): ConnectTarget {
  if (HOST_ID_PATTERN.test(text)) return { kind: "host", hostId: text };
  if (URL.canParse(text) && new URL(text).hash !== "") return { kind: "link", link: parsePairingUrl(text) };
  const code = codeOf(text);
  if (code !== undefined) return { kind: "code", code };
  throw new Error(`expected a hostId, a pairing link or an 8-character pairing code, got ${JSON.stringify(text)}`);
}
