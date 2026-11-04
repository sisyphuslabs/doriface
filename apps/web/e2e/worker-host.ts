// Each Playwright worker runs its own e2e host (host.ts): its own port, hc session, core and added machine, so specs
// that count the core's terminals never see another worker's. The playwright runner is Node, so this uses child_process.
import { type ChildProcess, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { E2E_SLOT, hostPortOf } from "./config.ts";

const HOST_SCRIPT = fileURLToPath(new URL("./host.ts", import.meta.url));
/** Setup seeds the core and adds a machine (a second core) before /healthz answers. */
const READY_WITHIN_MS = 120_000;

function exitOf(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => child.once("exit", (code) => resolve(code)));
}

async function healthy(url: string, exited: Promise<number | null>): Promise<void> {
  const deadline = Date.now() + READY_WITHIN_MS;
  let gone = false;
  void exited.then(() => (gone = true));
  while (!gone) {
    // oxlint-disable-next-line no-await-in-loop -- readiness: ask again until the host answers, as webServer does
    const ok = await fetch(url, { signal: AbortSignal.timeout(2_000) }).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) return;
    if (Date.now() > deadline) throw new Error(`the e2e host on ${url} did not answer within ${READY_WITHIN_MS} ms`);
    // oxlint-disable-next-line no-await-in-loop -- as above
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 250))]);
  }
  throw new Error(`the e2e host for ${url} exited during setup (exit ${String(await exited)})`);
}

/** Starts this worker's e2e host and resolves once it answers; the returned stop ends it, core included. */
export async function startWorkerHost(): Promise<() => Promise<void>> {
  // The host reads its port from E2E_HOST_PORT; without a worker slot of its own it takes that port as is.
  const port = hostPortOf(E2E_SLOT);
  const env: NodeJS.ProcessEnv = { ...process.env, E2E_HOST_PORT: String(port) };
  delete env["TEST_PARALLEL_INDEX"];
  const child = spawn("bun", [HOST_SCRIPT], { env, stdio: ["ignore", "inherit", "inherit"] });
  const exited = exitOf(child);
  await healthy(`http://127.0.0.1:${port}/healthz`, exited);
  return async () => {
    child.kill("SIGTERM");
    await exited;
  };
}
