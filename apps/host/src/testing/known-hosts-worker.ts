import { generateHostIdentity } from "@doriface/crypto";
import { KnownHosts } from "../state/known-hosts.ts";

/** A separate process for the lock race test: `add <dir> <count>` pairs fresh hosts one at a time, each under the lock. */
const [op, dir, count] = process.argv.slice(2);
if (op !== "add" || dir === undefined) throw new Error("usage: known-hosts-worker add <dir> <count>");
const store = new KnownHosts(dir, { lockTimeoutMs: 10_000 });
for (let i = 0; i < Number(count); i++) {
  const host = generateHostIdentity();
  store.add({ hostId: host.hostId, hostKey: host.noise.publicKey, relayUrl: "wss://relay.example" });
  process.stdout.write(`${host.hostId}\n`);
}
