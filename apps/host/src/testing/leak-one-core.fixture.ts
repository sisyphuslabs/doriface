// Not a *.test.ts, so `bun test` never picks it up; test-run.hc.test.ts runs it by path. It leaves one herdr core
// running, started outside createHcSession with this run's environment (its mark included) in the run's $TMPDIR, and
// writes its socket's path to $LEAK_DIR/socket.
import { test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveHcBin } from "./hc-session.ts";

test("leaves one core running", async () => {
  const leak = process.env["LEAK_DIR"];
  if (leak === undefined) throw new Error("LEAK_DIR is not set");
  // In the run's own $TMPDIR, as every scratch session of a run is; LEAK_DIR only says where.
  const dir = mkdtempSync(join(tmpdir(), "dh-leak-"));
  writeFileSync(join(leak, "socket"), join(dir, "c.sock"));
  const proc = Bun.spawn([resolveHcBin(), "connect", "--session", "leak-fixture"], {
    env: {
      ...process.env,
      HC_SOCKET: join(dir, "c.sock"),
      XDG_STATE_HOME: join(dir, "state"),
      XDG_RUNTIME_DIR: join(dir, "run"),
    },
    stdin: "pipe",
    stdout: "pipe",
  });
  proc.stdin.write('{"jsonrpc":"2.0","id":1,"method":"server.status"}\n');
  await proc.stdin.flush();
  const reader = proc.stdout.getReader();
  await reader.read();
  reader.releaseLock();
  void proc.stdin.end();
  await proc.exited;
});
