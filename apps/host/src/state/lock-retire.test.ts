import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateToken } from "../auth.ts";
import { startHost } from "../host.ts";
import { createHcSession } from "../testing/hc-session.ts";
import { type LockStep, retireStateLock, withStateLock } from "./lock.ts";

/** How a host from before #270 takes its lock: `state.lock` is a file it creates and reads back. */
function olderReaderTakes(stateDir: string): string {
  const path = join(stateDir, "state.lock");
  writeFileSync(path, `${process.pid} older`, { flag: "wx" });
  try {
    return readFileSync(path, "utf8");
  } finally {
    rmSync(path, { force: true });
  }
}

const steps = () => {
  const seen: string[] = [];
  return { seen, step: (step: LockStep, generation: number) => void seen.push(`${step} ${generation}`) };
};

describe("a state lock retired on a clean stop (#297)", () => {
  test("leaves no state.lock, so a host from before #270 takes its lock; the next take numbers above the retired one", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "dh-lock-retire-"));
    try {
      expect(withStateLock(stateDir, () => "done")).toBe("done");
      retireStateLock(stateDir);
      expect(existsSync(join(stateDir, "state.lock"))).toBe(false);
      expect(olderReaderTakes(stateDir)).toBe(`${process.pid} older`);
      // Generations 1 (a take) and 3 (the retire, after the free 2): a fresh directory starts above 3.
      const next = steps();
      expect(withStateLock(stateDir, () => "again", 1_000, next.step)).toBe("again");
      expect(next.seen.slice(0, 2)).toEqual(["observed 3", "published 4"]);
      retireStateLock(stateDir);
      expect(readdirSync(stateDir).filter((name) => name.startsWith("state.lock"))).toHaveLength(1);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("a host started and stopped cleanly on a state dir leaves no state.lock", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "dh-lock-host-"));
    // Its own scratch core: a host on the default session would start the default core on any call to the core.
    const session = createHcSession("lock-host");
    try {
      const host = await startHost({
        listen: { hostname: "127.0.0.1", port: 0 },
        token: generateToken(),
        hc: session.hc,
        session: session.name,
        env: session.env,
        stateDir,
        log: () => {},
      });
      await host.stop();
      expect(existsSync(join(stateDir, "state.lock"))).toBe(false);
      expect(olderReaderTakes(stateDir)).toBe(`${process.pid} older`);
    } finally {
      await session.dispose();
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("a take whose lock directory is retired under it makes a fresh one above the retired generation", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "dh-lock-waiter-"));
    const dir = join(stateDir, "state.lock");
    try {
      // A live holder (this pid) at generation 5: the take waits on it, and the holder retires the directory meanwhile.
      mkdirSync(dir, { mode: 0o700 });
      writeFileSync(join(dir, "5"), `${process.pid} holder`);
      let retired = false;
      const seen: string[] = [];
      const value = withStateLock(
        stateDir,
        () => "taken",
        2_000,
        (step, generation) => {
          seen.push(`${step} ${generation}`);
          if (step !== "waiting" || retired) return;
          retired = true;
          rmSync(join(dir, "5"));
          mkdirSync(join(stateDir, "state.lock.retired-5-x"));
          rmSync(dir, { recursive: true });
        },
      );
      expect(value).toBe("taken");
      expect(seen).toContain("published 6");
      expect(seen).not.toContain("published 1");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("a directory a crashed holder left is still taken, and retired on the next clean stop", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "dh-lock-crash-"));
    const dir = join(stateDir, "state.lock");
    try {
      mkdirSync(dir, { mode: 0o700 });
      // A pid that is not running: the holder crashed while it held generation 3.
      writeFileSync(join(dir, "3"), "999999999 crashed");
      expect(withStateLock(stateDir, () => "taken", 1_000)).toBe("taken");
      retireStateLock(stateDir, 1_000);
      expect(existsSync(dir)).toBe(false);
      expect(olderReaderTakes(stateDir)).toBe(`${process.pid} older`);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
