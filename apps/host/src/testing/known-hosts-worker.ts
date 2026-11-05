import { base64urlEncode, generateHostIdentity, generateX25519 } from "@doriface/crypto";
import { confirmReplacement } from "../connect/dial.ts";
import { KnownHosts } from "../state/known-hosts.ts";

/**
 * A separate process for the lock race tests:
 * - `add <dir> <count>` pairs fresh hosts one at a time, each under the lock.
 * - `pair <dir> <hostId>` pairs hostId with a fresh key as `doriface-host connect` does, without --replace: it checks
 *   the saved record before it would dial, says `checked`, waits for a line on stdin (the other process has checked
 *   too), then saves, and says `saved <key>`.
 */
const [op, dir, arg] = process.argv.slice(2);
if ((op !== "add" && op !== "pair") || dir === undefined || arg === undefined) {
  throw new Error("usage: known-hosts-worker add <dir> <count> | pair <dir> <hostId>");
}
const store = new KnownHosts(dir, { lockTimeoutMs: 10_000 });
if (op === "add") {
  for (let i = 0; i < Number(arg); i++) {
    const host = generateHostIdentity();
    store.add({ hostId: host.hostId, hostKey: host.noise.publicKey, relayUrl: "wss://relay.example" });
    process.stdout.write(`${host.hostId}\n`);
  }
} else {
  const host = { hostId: arg, hostKey: generateX25519().publicKey, relayUrl: "wss://relay.example" };
  const options = { log: (line: string) => process.stderr.write(`${line}\n`), replace: false };
  const checked = store.get(arg);
  confirmReplacement(checked, host, options);
  process.stdout.write("checked\n");
  await Bun.stdin.stream().getReader().read();
  store.replace(host, checked, (saved) => confirmReplacement(saved, host, options));
  process.stdout.write(`saved ${base64urlEncode(host.hostKey)}\n`);
}
