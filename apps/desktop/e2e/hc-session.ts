import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A scratch hc session (own core, state and socket) so the launch test never touches a real one. */
export function scratchHcSession(): { readonly env: Record<string, string>; dispose(): Promise<void> } {
  const hc = process.env["HC_BIN"];
  if (hc === undefined || hc === "") throw new Error("the launch test needs HC_BIN pointing at hc 0.1.17");
  const dir = mkdtempSync(join(tmpdir(), "dd-e2e-"));
  const name = `doriface-desktop-e2e-${process.pid}`;
  const env = {
    HC_BIN: hc,
    HC_SESSION: name,
    XDG_STATE_HOME: join(dir, "state"),
    XDG_RUNTIME_DIR: join(dir, "run"),
    HC_SOCKET: join(dir, "c.sock"),
  };
  const dispose = async (): Promise<void> => {
    const control = spawn(hc, ["connect", "--session", name], { env: { ...process.env, ...env } });
    const replied = new Promise<void>((resolve) => control.stdout.once("data", () => resolve()));
    control.stdin.write('{"jsonrpc":"2.0","id":1,"method":"server.stop"}\n');
    await replied;
    control.stdin.end();
    await new Promise<void>((resolve) => control.once("exit", () => resolve()));
    rmSync(dir, { recursive: true, force: true });
  };
  return { env, dispose };
}
