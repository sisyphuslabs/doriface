// Not a *.test.ts, so `bun test` never picks it up; test-run.hc.test.ts runs it by path. It passes, leaving a detached
// shell with this run's environment (its mark included) that starts a herdr core in $LEAK_DIR a moment after the test
// has ended, so after `bun test` has exited.
import { test } from "bun:test";
import { join } from "node:path";
import { resolveHcBin } from "./hc-session.ts";

test("leaves a shell that starts a core after the run", () => {
  const dir = process.env["LEAK_DIR"];
  if (dir === undefined) throw new Error("LEAK_DIR is not set");
  const proc = Bun.spawn(["sh", "-c", 'sleep 1; exec "$0" connect --session leak-late </dev/null', resolveHcBin()], {
    env: {
      ...process.env,
      HC_SOCKET: join(dir, "c.sock"),
      XDG_STATE_HOME: join(dir, "state"),
      XDG_RUNTIME_DIR: join(dir, "run"),
    },
    stdio: ["ignore", "ignore", "ignore"],
    detached: true,
  });
  proc.unref();
});
