// Starts doriface-host in loopback dev mode on a scratch hc session; stops the core and deletes its state on exit.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { E2E_HOST_PORT, E2E_TOKEN } from "./config.ts";
import { seed } from "./seed.ts";

const hc = process.env["HC_BIN"] || Bun.which("hc");
if (hc === null || hc === undefined || hc === "") throw new Error("set HC_BIN to an hc 0.1.17 binary");
const dir = mkdtempSync(join(tmpdir(), "dw-"));
const session = `web-e2e-${crypto.randomUUID().slice(0, 8)}`;
const env = {
  ...process.env,
  HC_SESSION: session,
  XDG_STATE_HOME: join(dir, "state"),
  XDG_RUNTIME_DIR: join(dir, "run"),
  HC_SOCKET: join(dir, "c.sock"),
  // A plain shell and a neutral core name keep captures free of this machine's identity.
  SHELL: "/bin/sh",
  PS1: "$ ",
  ENV: "",
  BASH_SILENCE_DEPRECATION_WARNING: "1",
};
const coreDir = join(dir, "state", "herdr-core", session);
mkdirSync(coreDir, { recursive: true });
writeFileSync(
  join(coreDir, "core.json"),
  JSON.stringify({ id: crypto.randomUUID().replace(/-/g, ""), name: "studio" }),
);
const host = Bun.spawn(
  [
    "bun",
    join(import.meta.dir, "../../host/src/cli.ts"),
    "--listen",
    `127.0.0.1:${E2E_HOST_PORT}`,
    "--hc",
    hc,
    "--session",
    session,
    "--token",
    E2E_TOKEN,
  ],
  { env, stdout: "inherit", stderr: "inherit" },
);

async function stopCore(): Promise<void> {
  const control = Bun.spawn([hc ?? "hc", "connect", "--session", session], { env, stdin: "pipe", stdout: "pipe" });
  control.stdin.write('{"jsonrpc":"2.0","id":1,"method":"server.stop"}\n');
  await control.stdin.flush();
  void control.stdin.end();
  await control.exited;
}

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  host.kill("SIGTERM");
  await host.exited;
  await stopCore();
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}
if (process.env["CAPTURE"] === "1") {
  await seed(hc, env, join(dir, "work"));
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
await host.exited;
if (!stopping) await shutdown();
