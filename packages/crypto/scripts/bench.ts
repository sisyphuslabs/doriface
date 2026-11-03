import { generateHostIdentity, generateX25519 } from "../src/identity.ts";
import { Handshake } from "../src/noise/handshake.ts";
import { MAX_PLAINTEXT, Transport } from "../src/transport.ts";

/** Encrypts and then decrypts TOTAL bytes in full-size records through one established Noise IK session. */
const TOTAL = 64 * 1024 * 1024;
const ROUNDS = 5;

function session(): readonly [Transport, Transport] {
  const host = generateHostIdentity();
  const prologue = new Uint8Array(0);
  const initiator = new Handshake({
    pattern: "IK",
    role: "initiator",
    prologue,
    staticKey: generateX25519(),
    remoteStatic: host.noise.publicKey,
  });
  const responder = new Handshake({ pattern: "IK", role: "responder", prologue, staticKey: host.noise });
  responder.readMessage(initiator.writeMessage(new Uint8Array(0)));
  initiator.readMessage(responder.writeMessage(new Uint8Array(0)));
  const i = initiator.finish();
  const r = responder.finish();
  return [new Transport(i.send, i.receive), new Transport(r.send, r.receive)];
}

const mib = (bytes: number, ms: number): string => ((bytes / 1024 / 1024 / ms) * 1000).toFixed(1);
const chunk = crypto.getRandomValues(new Uint8Array(MAX_PLAINTEXT));
const results: { readonly seal: number; readonly open: number }[] = [];
for (let round = 0; round < ROUNDS; round++) {
  const [sender, receiver] = session();
  const records: Uint8Array[] = [];
  let start = performance.now();
  for (let sent = 0; sent < TOTAL; sent += MAX_PLAINTEXT) {
    records.push(...sender.seal(chunk.subarray(0, Math.min(MAX_PLAINTEXT, TOTAL - sent))));
  }
  const seal = performance.now() - start;
  start = performance.now();
  for (const record of records) receiver.open(record);
  results.push({ seal, open: performance.now() - start });
}
const best = (key: "seal" | "open"): number => Math.min(...results.map((r) => r[key]));
const both = Math.min(...results.map((r) => r.seal + r.open));
console.log(
  `@doriface/crypto ChaChaPoly records of ${MAX_PLAINTEXT} B, ${TOTAL / 1024 / 1024} MiB, best of ${ROUNDS} on ${process.platform}-${process.arch} bun ${Bun.version}`,
);
console.log(
  `encrypt ${mib(TOTAL, best("seal"))} MiB/s, decrypt ${mib(TOTAL, best("open"))} MiB/s, encrypt+decrypt ${mib(TOTAL, both)} MiB/s`,
);
