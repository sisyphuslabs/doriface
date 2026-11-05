// A real doriface-host and hc core behind the private relay under wrangler dev, for the browser specs that must reach
// a terminal THROUGH the relay (terminal-links-relay.e2e.ts). Run with bun; it prints one READY line with what the page
// needs, then keeps everything up until it is sent SIGTERM or SIGINT, which stops the host, the core and the relay.
import { startRelayedHost } from "./relayed-host.ts";

const relayed = await startRelayedHost("web-links");
process.stdout.write(`READY ${JSON.stringify({ relayUrl: relayed.relayUrl })}\n`);
// The host keeps one pairing offer open at a time, so each spec asks for its own link (a line on stdin) just before
// it pairs, and gets back `LINK <fragment>`.
let pending = Promise.resolve();
process.stdin.on("data", (chunk: Buffer) => {
  const asks = chunk
    .toString()
    .split("\n")
    .filter((line) => line.trim() === "PAIR");
  pending = asks.reduce(
    (chain) =>
      chain.then(() => relayed.pairingLink()).then((link) => void process.stdout.write(`LINK ${new URL(link).hash}\n`)),
    pending,
  );
});

let stopping = false;
const stop = (): void => {
  if (stopping) return;
  stopping = true;
  relayed.stop().then(
    () => process.exit(0),
    (error: unknown) => {
      process.stderr.write(`relay-host: stop failed: ${String(error)}\n`);
      process.exit(1);
    },
  );
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
