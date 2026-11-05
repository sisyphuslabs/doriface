/**
 * A relayed host for a browser test: the local relay (wrangler dev), an hc core and a doriface-host on its uplink.
 * Prints one JSON line, `{"link": ...}`, the pairing link for the web origin given as the first argument, then runs
 * until it is sent SIGTERM or its stdin closes, and stops everything it started.
 *
 *   bun tests/relay/support/browser-relayed-host.ts http://127.0.0.1:4173
 */
import { startRelayedHost } from "./relayed-host.ts";

const webOrigin = process.argv[2];
if (webOrigin === undefined || !/^https?:\/\//.test(webOrigin)) {
  console.error("usage: browser-relayed-host.ts <web origin>");
  process.exit(2);
}

const host = await startRelayedHost("browser-relay");
const done = Promise.withResolvers<void>();
process.once("SIGTERM", () => done.resolve());
process.once("SIGINT", () => done.resolve());
process.stdin.on("end", () => done.resolve());
process.stdin.resume();
try {
  const { url } = await host.pairingOffer();
  console.log(JSON.stringify({ link: url.replace(/^https:\/\/web\.example/, webOrigin) }));
  await done.promise;
} finally {
  await host.stop();
}
process.exit(0);
