import {
  DEFAULT_PAIRING_WEB_ORIGIN,
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
import { type PendingPairing, PairingStore, pendingFromWire } from "../state/pairing.ts";
import { pairingArtifact, type PairingArtifact, phonePairingLink } from "../pair-link.ts";

export const PAIR_USAGE = `usage: doriface-host pair [options]

  --web-origin <url>  the web app that opens the link and the QR code (default: the desktop app's deep link for
                      the link, ${DEFAULT_PAIRING_WEB_ORIGIN} for the QR code)
  --relay <url>       the relay the device dials (default ${DEFAULT_RELAY_URL})
  --state-dir <dir>   the host's state (default $DORIFACE_HOST_STATE_DIR, else $XDG_STATE_HOME/doriface-host)
  --no-qr             print no QR code`;

/** Asks the running host to open the pairing (it registers the relay slot first); without one, writes it directly. */
async function openOffer(stateDir: string): Promise<PendingPairing> {
  const answer = await requestControl(stateDir, { op: "pair" });
  return answer === undefined ? new PairingStore(stateDir).offer() : pendingFromWire(answer);
}

const SLOT_NOTES = {
  registered: "",
  unavailable: "  (no relay slot: pair with the link or QR code)",
  pending: "  (not registered with the relay yet: start doriface-host, or pair with the link or QR code)",
} as const;

function opensWith(opens: PairingArtifact["opens"]): string {
  switch (opens) {
    case "web":
      return "Open this link in a browser";
    case "desktop":
      return "Open this link in the doriface desktop app";
  }
}

/** Opens a single-use pairing (replacing any pending one) and prints its link, QR code, typed code and fingerprint. */
export async function pairCommand(args: readonly string[], out: (text: string) => void): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    strict: true,
    allowPositionals: false,
    options: {
      "web-origin": { type: "string" },
      relay: { type: "string", default: DEFAULT_RELAY_URL },
      "state-dir": { type: "string" },
      "no-qr": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) return out(`${PAIR_USAGE}\n`);
  const webOrigin = values["web-origin"];
  if (webOrigin !== undefined) pairingWebOrigin(webOrigin);
  relayWebSocketUrl(values.relay);
  const stateDir = values["state-dir"] ?? defaultStateDir();
  const identity = loadHostIdentity(stateDir);
  const offer = await openOffer(stateDir);
  const target = {
    hostId: identity.hostId,
    noiseStaticPub: identity.noise.publicKey,
    signPub: identity.sign.publicKey,
    linkSecret: offer.linkSecret,
    relayUrl: values.relay,
  };
  const artifact = pairingArtifact(target, webOrigin);
  const ways = values["no-qr"] ? "or type the code" : "scan the QR code with a phone, or type the code";
  const lines = [
    `${opensWith(artifact.opens)} on the device you want to pair, ${ways}. It works once, for ${PAIRING_TTL_MS / 60_000} minutes.`,
    "",
    ...(values["no-qr"]
      ? []
      : [renderUnicodeCompact(phonePairingLink(target, webOrigin), { ecc: "L", border: 2 }), ""]),
    artifact.url,
    "",
    `code        ${formatPairingCode(offer.code)}${SLOT_NOTES[offer.slot]}`,
    `fingerprint ${fingerprintOf(identity.noise.publicKey)}`,
    `host        ${identity.hostId}`,
    `expires     ${new Date(offer.expiresAt).toISOString()}`,
  ];
  out(`${lines.join("\n")}\n`);
}
