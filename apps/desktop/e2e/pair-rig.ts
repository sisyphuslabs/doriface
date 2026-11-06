// The stand-in relay and the web app's server for the pairing specs, in their own Bun process: the Playwright runner
// is Node, which can neither start a Bun.serve nor import the host's Bun-only test helpers.
//
//   bun e2e/pair-rig.ts <web dist> <host cli> <wrapper path>
//
// Writes the wrapper the app spawns as its host (the same CLI, on this relay instead of the release one),
// prints one JSON line ({ bridge, lookup, webUrl, relay, hostCli }) and stays up until its stdin closes or it is
// told to stop.
import { FakeRelay, RelayClientBridge } from "@doriface/host/testing";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const [webDist, hostCli, hostBinary] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
if (webDist === undefined || hostCli === undefined || hostBinary === undefined) {
  console.error("usage: pair-rig.ts <web dist> <host cli> <wrapper path>");
  process.exit(2);
}

const relay = new FakeRelay();
const bridge = new RelayClientBridge(relay);

mkdirSync(dirname(hostBinary), { recursive: true });
writeFileSync(
  hostBinary,
  `#!/usr/bin/env bun
const args = process.argv.slice(2);
const passed: string[] = [];
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--relay") {
    index += 1;
    continue;
  }
  passed.push(args[index] ?? "");
}
const child = Bun.spawn(
  [Bun.which("bun") ?? "bun", process.env["DORIFACE_E2E_HOST_CLI"] ?? "", "--relay", ${JSON.stringify(relay.url)}, ...passed],
  { stdin: "ignore", stdout: "ignore", stderr: "inherit" },
);
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => child.kill(signal));
process.exit(await child.exited);
`,
  { mode: 0o755 },
);
chmodSync(hostBinary, 0o755);
const lookup = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const slot = new URL(request.url).pathname.split("/").at(-1) ?? "";
    const record = relay.pairLookup(slot);
    return record === undefined ? new Response("", { status: 404 }) : Response.json(record);
  },
});
const web = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    // The service worker is not served: the pairing page must not reload while a code is being typed.
    if (path === "/sw.js" || path.startsWith("/workbox-")) return new Response("", { status: 404 });
    const file = Bun.file(`${webDist}${path === "/" ? "/index.html" : path}`);
    return (await file.exists()) ? new Response(file) : new Response(Bun.file(`${webDist}/index.html`));
  },
});

console.log(
  JSON.stringify({
    bridge: bridge.url,
    lookup: `http://127.0.0.1:${lookup.port ?? 0}`,
    webUrl: `http://127.0.0.1:${web.port ?? 0}`,
    relay: relay.url,
    hostCli,
  }),
);

const done = Promise.withResolvers<void>();
process.once("SIGTERM", () => done.resolve());
process.once("SIGINT", () => done.resolve());
void Bun.stdin
  .stream()
  .getReader()
  .read()
  .then(() => done.resolve());
try {
  await done.promise;
} finally {
  await web.stop(true);
  await lookup.stop(true);
  await bridge.stop();
  await relay.stop();
}
process.exit(0);
