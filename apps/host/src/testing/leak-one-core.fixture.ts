// Not a *.test.ts, so `bun test` never picks it up; test-run.hc.test.ts runs it by path. It leaves one herdr core
// running, started outside createHcSession with this run's environment (its mark included), in $LEAK_DIR.
import { test } from "bun:test";
import { join } from "node:path";
import { resolveHcBin } from "./hc-session.ts";

test("leaves one core running", async () => {
  const dir = process.env["LEAK_DIR"];
  if (dir === undefined) throw new Error("LEAK_DIR is not set");
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
