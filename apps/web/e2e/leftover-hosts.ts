// Global teardown: each worker stops its own e2e host (and its cores) when it ends, and the host deletes its saved
// environment as it goes. A saved environment still here means a host outlived its worker: stop it, and fail the run
// naming it, so no core is left running (the web e2e counterpart of the host tests' leftover-core guard).
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import type { FullConfig } from "@playwright/test";
import { hostEnvOf, hostPortOf } from "./config.ts";
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

export default async function leftoverHosts(config: FullConfig): Promise<void> {
  const left: string[] = [];
  for (let slot = 0; slot < config.workers; slot++) {
    const file = hostEnvOf(hostPortOf(slot));
    // oxlint-disable-next-line no-await-in-loop -- one host at a time, each fully stopped before the next
    if (existsSync(file)) left.push(`slot ${slot}: ${await stopHost(file)}`);
  }
  if (left.length > 0) throw new Error(`e2e hosts outlived their workers (now stopped): ${left.join(", ")}`);
}
