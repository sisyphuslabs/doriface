import { buildPairingUrl, DEFAULT_RELAY_URL, fingerprintOf, PAIRING_TTL_MS } from "@doriface/crypto";
import { parseArgs } from "node:util";
import { renderUnicodeCompact } from "uqr";
import { defaultStateDir } from "../state/files.ts";
import { loadHostIdentity } from "../state/host-keys.ts";
import { PairingStore } from "../state/pairing.ts";

export const DEFAULT_WEB_ORIGIN = "https://doriface.omo.dev";

export const PAIR_USAGE = `usage: doriface-host pair [options]

  --web-origin <url>  the web app that opens the link (default ${DEFAULT_WEB_ORIGIN})
  --relay <url>       the relay the device dials (default ${DEFAULT_RELAY_URL})
  --state-dir <dir>   the host's state (default $DORIFACE_HOST_STATE_DIR, else $XDG_STATE_HOME/doriface-host)
  --no-qr             print only the link`;

/** Creates a single-use pairing code (replacing any pending one) and prints the pairing link and its QR code. */
export function pairCommand(args: readonly string[], out: (text: string) => void): void {
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
  if (!URL.canParse(values.relay)) throw new Error(`--relay wants a URL, got ${JSON.stringify(values.relay)}`);
  const stateDir = values["state-dir"] ?? defaultStateDir();
  const identity = loadHostIdentity(stateDir);
  const offer = new PairingStore(stateDir).offer();
  const url = buildPairingUrl({
    webOrigin: values["web-origin"],
    hostId: identity.hostId,
    noiseStaticPub: identity.noise.publicKey,
    signPub: identity.sign.publicKey,
    code: offer.code,
    relayUrl: values.relay,
  });
  const minutes = PAIRING_TTL_MS / 60_000;
  const lines = [
    `Open this link on the device you want to pair, or scan the code. It works once, for ${minutes} minutes.`,
    "",
    ...(values["no-qr"] ? [] : [renderUnicodeCompact(url, { ecc: "L", border: 2 }), ""]),
    url,
    "",
    `host        ${identity.hostId}`,
    `fingerprint ${fingerprintOf(identity.noise.publicKey)}`,
    `expires     ${new Date(offer.expiresAt).toISOString()}`,
  ];
  out(`${lines.join("\n")}\n`);
}
