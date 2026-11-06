import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateX25519 } from "@doriface/crypto";
import { generateToken } from "../auth.ts";
import { type Host, startHost } from "../host.ts";
import { loadHostIdentity } from "../state/host-keys.ts";
import { createHcSession, resolveHcBin } from "../testing/hc-session.ts";
import { machine, MeshFixture } from "../testing/mesh-history.ts";

const STILL_RUNNING = 0;

/** A killed and reaped child answers ESRCH, so this reads a process state, not a timing. */
function running(pid: number): boolean {
  try {
    process.kill(pid, STILL_RUNNING);
    return true;
  } catch {
    return false;
  }
}

/** A raw connect starts no core. */
async function serving(socket: string): Promise<boolean> {
  try {
    const probe = await Bun.connect({ unix: socket, socket: { data: () => {} } });
    probe.end();
    return true;
  } catch {
    return false;
  }
}

/** Waits for the event `read` reports, at most `timeoutMs`: the deadline is a circuit breaker, never the signal. */
async function until(read: () => Promise<boolean>, deadline: number): Promise<boolean> {
  if (await read()) return true;
  if (Date.now() >= deadline) return false;
  await Bun.sleep(10);
  return until(read, deadline);
}

function pidIn(path: string): number | undefined {
  try {
    const pid = Number(readFileSync(path, "utf8").trim());
    return Number.isInteger(pid) && pid > STILL_RUNNING ? pid : undefined;
  } catch {
    return undefined;
  }
}

/**
 * An `hc` that holds every `connect` at a gate the test opens and answers `--version` at once, so the host starts its
 * runtime with a launch still in flight, as a launch a busy machine holds past the host's stop does (#441).
 */
function gatedHc(dir: string): { hc: string; gate: string; launched: string } {
  const gate = join(dir, "launch.gate");
  const launched = join(dir, "launcher.pid");
  const hc = join(dir, "hc");
  writeFileSync(
    hc,
    `#!/bin/sh\nif [ "$1" = "connect" ]; then\n  printf '%s' "$$" >> "${launched}"\n  while [ ! -e "${gate}" ]; do sleep 0.01; done\nfi\nexec "${resolveHcBin()}" "$@"\n`,
    { mode: 0o755 },
  );
  return { hc, gate, launched };
}

describe("a core launch does not outlive the host that made it (#441)", () => {
  test("a launch still opening when the host stops is gone, so it starts no core after the test", async () => {
    const session = createHcSession("core-launch");
    const socket = session.env["HC_SOCKET"] ?? "";
    const dir = mkdtempSync(join(tmpdir(), "dh-host-launch-"));
    let leaked = false;
    try {
      const self = { identity: loadHostIdentity(dir), device: generateX25519(), name: "studio", hcId: "core-studio" };
      const mesh = new MeshFixture(dir, self);
      mesh.admit(self, machine("laptop"));
      const { hc, gate, launched } = gatedHc(dir);
      const host: Host = await startHost({
        listen: { hostname: "127.0.0.1", port: 0 },
        token: generateToken(),
        hc,
        session: session.name,
        env: session.env,
        stateDir: dir,
        log: () => {},
      });
      const started = await until(async () => pidIn(launched) !== undefined, Date.now() + 10_000);
      const pid = pidIn(launched) ?? STILL_RUNNING;
      expect({ launched: started, pid: pid > STILL_RUNNING }).toEqual({ launched: true, pid: true });

      await host.stop();
      const survived = running(pid);
      writeFileSync(gate, "");
      const served = survived && (await until(() => serving(socket), Date.now() + 10_000));
      leaked = survived || served;
      expect({ launchSurvivedStop: survived, coreServed: served }).toEqual({
        launchSurvivedStop: false,
        coreServed: false,
      });
    } finally {
      if (!leaked) await session.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
