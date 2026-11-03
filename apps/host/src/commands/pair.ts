import {
  buildPairingUrl,
  DEFAULT_RELAY_URL,
  fingerprintOf,
  formatPairingCode,
  PAIRING_TTL_MS,
  pairingWebOrigin,
  relayWebSocketUrl,
} from "@doriface/crypto";
import { parseArgs } from "node:util";
import { renderUnicodeCompact } from "uqr";
import { requestControl } from "../control.ts";
import { defaultStateDir } from "../state/files.ts";
import { loadHostIdentity } from "../state/host-keys.ts";
import { type PendingPairing, PairingStore } from "../state/pairing.ts";

export const DEFAULT_WEB_ORIGIN = "https://doriface.omo.dev";

export const PAIR_USAGE = `usage: doriface-host pair [options]

  --web-origin <url>  the web app that opens the link (default ${DEFAULT_WEB_ORIGIN})
  --relay <url>       the relay the device dials (default ${DEFAULT_RELAY_URL})
  --state-dir <dir>   the host's state (default $DORIFACE_HOST_STATE_DIR, else $XDG_STATE_HOME/doriface-host)
  --no-qr             print no QR code`;

function asPending(value: unknown): PendingPairing {
  if (typeof value === "object" && value !== null && "code" in value && "expiresAt" in value) {
    const { code, expiresAt } = value;
    const slot = "slot" in value ? value.slot : undefined;
    const knownSlot = slot === "pending" || slot === "registered" || slot === "unavailable";
    if (typeof code === "string" && typeof expiresAt === "number" && knownSlot) {
      return { code, expiresAt, slot };
    }
  }
  throw new Error("the running host sent a malformed pairing");
}

/** Asks the running host to open the pairing (it registers the relay slot first); without one, writes it directly. */
async function openOffer(stateDir: string): Promise<PendingPairing> {
  const answer = await requestControl(stateDir, { op: "pair" });
  return answer === undefined ? new PairingStore(stateDir).offer() : asPending(answer);
}

const SLOT_NOTES = {
  registered: "",
  unavailable: "  (no relay slot: pair with the link or QR code)",
  pending: "  (not registered with the relay yet: start doriface-host, or pair with the link or QR code)",
} as const;

/** Opens a single-use pairing (replacing any pending one) and prints its link, QR code, typed code and fingerprint. */
export async function pairCommand(args: readonly string[], out: (text: string) => void): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    strict: true,
    allowPositionals: false,
    options: {
      "web-origin": { type: "string", default: DEFAULT_WEB_ORIGIN },
      relay: { type: "string", default: DEFAULT_RELAY_URL },
      "state-dir": { type: "string" },
      "no-qr": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) return out(`${PAIR_USAGE}\n`);
  relayWebSocketUrl(values.relay);
  pairingWebOrigin(values["web-origin"]);
  const stateDir = values["state-dir"] ?? defaultStateDir();
  const identity = loadHostIdentity(stateDir);
  const offer = await openOffer(stateDir);
  const url = buildPairingUrl({
    webOrigin: values["web-origin"],
    hostId: identity.hostId,
    noiseStaticPub: identity.noise.publicKey,
    signPub: identity.sign.publicKey,
    code: offer.code,
    relayUrl: values.relay,
  });
  const ways = values["no-qr"] ? "or type the code" : "scan the QR code, or type the code";
  const lines = [
    `Open this link on the device you want to pair, ${ways}. It works once, for ${PAIRING_TTL_MS / 60_000} minutes.`,
    "",
    ...(values["no-qr"] ? [] : [renderUnicodeCompact(url, { ecc: "L", border: 2 }), ""]),
    url,
    "",
    `code        ${formatPairingCode(offer.code)}${SLOT_NOTES[offer.slot]}`,
    `fingerprint ${fingerprintOf(identity.noise.publicKey)}`,
    `host        ${identity.hostId}`,
    `expires     ${new Date(offer.expiresAt).toISOString()}`,
  ];
  out(`${lines.join("\n")}\n`);
}
