// Each Playwright worker runs its own e2e host (host.ts): its own port, hc session, core and added machine, so specs
// that count the core's terminals never see another worker's. The playwright runner is Node, so this uses child_process.
import { type ChildProcess, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { E2E_LAYOUT_PORT, E2E_SLOT, E2E_WEB_PORT, hostEnvOf, hostPortOf } from "./config.ts";
import { readSavedEnv } from "./saved-env.ts";

const HOST_SCRIPT = fileURLToPath(new URL("./host.ts", import.meta.url));
/** Setup seeds the core and adds a machine (a second core) before /healthz answers. */
const READY_WITHIN_MS = 120_000;

/** The web tsconfig types ChildProcess without its EventEmitter half, so the exit is read from exitCode/signalCode. */
function exitOf(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    const tick = setInterval(() => {
      if (child.exitCode === null && child.signalCode === null) return;
      clearInterval(tick);
      resolve(child.exitCode);
    }, 100);
  });
}

async function healthy(
  url: string,
  envFile: string,
  child: ChildProcess,
  exited: Promise<number | null>,
): Promise<void> {
  const deadline = Date.now() + READY_WITHIN_MS;
  while (child.exitCode === null && child.signalCode === null) {
    // oxlint-disable-next-line no-await-in-loop -- readiness: ask again until the host answers, as webServer does
    const ok = await fetch(url, { signal: AbortSignal.timeout(2_000) }).then(
      (r) => r.ok,
      () => false,
    );
    // Another process can answer on this port (a second checkout's host): ready means the host saved here is this child.
    if (ok && existsSync(envFile) && readSavedEnv(envFile).pid === child.pid) return;
    if (Date.now() > deadline)
      throw new Error(
        `the e2e host for ${url} was not ready within ${READY_WITHIN_MS} ms (answered by another process: ${ok})`,
      );
    // oxlint-disable-next-line no-await-in-loop -- as above
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 250))]);
  }
  throw new Error(`the e2e host for ${url} exited during setup (exit ${String(await exited)})`);
}

/** Starts this worker's e2e host and resolves once it answers; the returned stop ends it, core included. */
export async function startWorkerHost(): Promise<() => Promise<void>> {
  // The host reads its port from E2E_HOST_PORT; without a worker slot of its own it takes that port as is.
  const port = hostPortOf(E2E_SLOT);
  if (port === E2E_LAYOUT_PORT || port === E2E_WEB_PORT) {
    throw new Error(
      `worker ${E2E_SLOT}'s host port ${port} is the layout or web port: keep those outside E2E_HOST_PORT..+workers-1`,
    );
  }
  const env: NodeJS.ProcessEnv = { ...process.env, E2E_HOST_PORT: String(port) };
  delete env["TEST_PARALLEL_INDEX"];
  const url = `http://127.0.0.1:${port}/healthz`;
  // A process already answering here (a second checkout's host) would pass the readiness check for this one.
  const taken = await fetch(url, { signal: AbortSignal.timeout(2_000) }).then(
    () => true,
    () => false,
  );
  if (taken)
    throw new Error(`port ${port} already answers before this worker's host starts: set E2E_HOST_PORT to a free range`);
  const child = spawn("bun", [HOST_SCRIPT], { env, stdio: ["ignore", "inherit", "inherit"] });
  const exited = exitOf(child);
  await healthy(url, hostEnvOf(port), child, exited);
  return async () => {
    child.kill("SIGTERM");
    await exited;
  };
}
