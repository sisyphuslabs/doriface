// Global teardown: each worker stops its own e2e host (and its cores) when it ends, and the host deletes its saved
// environment as it goes. A saved environment still here means a host outlived its worker: stop it, and fail the run
// naming it, so no core is left running (the web e2e counterpart of the host tests' leftover-core guard). The shared
// layout host is stopped here too, and fails the run on any hc process it had to stop as it shut down (#251).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import type { FullConfig } from "@playwright/test";
import { E2E_LAYOUT_ENV, E2E_LAYOUT_LEFT, hostEnvOf, hostPortOf } from "./config.ts";
import { readSavedEnv } from "./saved-env.ts";

const STOP_WITHIN_MS = 30_000;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopHost(file: string): Promise<string> {
  const { hc, env, pid } = readSavedEnv(file);
  const session = env["HC_SESSION"] ?? "?";
  if (pid !== undefined && alive(pid)) {
    process.kill(pid, "SIGTERM");
    const deadline = Date.now() + STOP_WITHIN_MS;
    // oxlint-disable-next-line no-await-in-loop -- waits for the host's own shutdown, which stops its cores
    while (alive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (existsSync(file)) {
    // The host is gone without its shutdown: stop its core directly, as host.ts would have.
    execFileSync(hc, ["connect", "--session", session], {
      env: { ...process.env, ...env },
      input: '{"jsonrpc":"2.0","id":1,"method":"server.stop"}\n',
      timeout: STOP_WITHIN_MS,
    });
    rmSync(file, { force: true });
  }
  return session;
}

/** How long the layout host's shutdown may take: its cores stop, then its leftover check waits for and stops the rest. */
const LAYOUT_STOP_WITHIN_MS = 60_000;

/**
 * Stops the layout host (a webServer, which Playwright stops only after this teardown) and returns what it left running
 * once it had stopped its cores, as "pid N: arguments" (never an environment); host.ts has stopped those already.
 */
export async function stopLayoutHost(envFile = E2E_LAYOUT_ENV, leftFile = E2E_LAYOUT_LEFT): Promise<string[]> {
  const pid = existsSync(envFile) ? readSavedEnv(envFile).pid : undefined;
  if (pid !== undefined && alive(pid)) {
    process.kill(pid, "SIGTERM");
    const deadline = Date.now() + LAYOUT_STOP_WITHIN_MS;
    // oxlint-disable-next-line no-await-in-loop -- the host is not this process's child: no exit event to wait on
    while (alive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 200));
    if (alive(pid)) return [`pid ${pid}: the layout host, still running ${LAYOUT_STOP_WITHIN_MS} ms after SIGTERM`];
  }
  if (!existsSync(leftFile)) return pid === undefined ? [] : [`pid ${pid}: the layout host stopped without its check`];
  const left = JSON.parse(readFileSync(leftFile, "utf8")) as { pid: number; command: string }[];
  rmSync(leftFile, { force: true });
  return left.map((one) => `pid ${one.pid}: ${one.command}`);
}

export default async function leftoverHosts(config: FullConfig): Promise<void> {
  const left: string[] = [];
  for (let slot = 0; slot < config.workers; slot++) {
    const file = hostEnvOf(hostPortOf(slot));
    // oxlint-disable-next-line no-await-in-loop -- one host at a time, each fully stopped before the next
    if (existsSync(file)) left.push(`slot ${slot}: ${await stopHost(file)}`);
  }
  const layout = await stopLayoutHost();
  const failures: string[] = [];
  if (left.length > 0) failures.push(`e2e hosts outlived their workers (now stopped): ${left.join(", ")}`);
  if (layout.length > 0) failures.push(`hc processes left by the layout host (now stopped):\n  ${layout.join("\n  ")}`);
  if (failures.length > 0) throw new Error(failures.join("\n"));
}
