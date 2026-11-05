import { describe, expect, test } from "bun:test";
import { chmodSync, linkSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOCK_WEDGED_EXIT_CODE, withStateLock } from "./lock.ts";

const WORKER = join(import.meta.dir, "..", "testing", "lock-release-worker.ts");

const failing = (code: string) => Object.assign(new Error(`${code}: injected link failure`), { code });

describe("a release whose link fails", () => {
  test("exits loudly with the errno and a distinct code, and a restarted host then takes the lock", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "dh-lock-release-"));
    try {
      const worker = Bun.spawn([process.execPath, WORKER, stateDir], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, status] = await Promise.all([
        new Response(worker.stdout).text(),
        new Response(worker.stderr).text(),
        worker.exited,
      ]);
      expect(status).toBe(LOCK_WEDGED_EXIT_CODE);
      expect(stdout).toBe("");
      expect(stderr).toContain("state lock");
      expect(stderr).toContain("EACCES");
      chmodSync(join(stateDir, "state.lock"), 0o700);
      // The next start: the exited holder's generation names a dead pid, so it is published over.
      expect(withStateLock(stateDir, () => "taken", 1_000)).toBe("taken");
    } finally {
      chmodSync(join(stateDir, "state.lock"), 0o700);
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("a link that fails and then succeeds releases the lock, so the next take does not wait", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "dh-lock-retry-"));
    try {
      let failures = 1;
      const link = (from: string, to: string) => {
        if (from.includes("free") && failures > 0) {
          failures -= 1;
          throw failing("EIO");
        }
        linkSync(from, to);
      };
      const wedged: unknown[] = [];
      withStateLock(stateDir, () => undefined, 1_000, undefined, { link, wedged: (error) => wedged.push(error) });
      expect(failures).toBe(0);
      expect(wedged).toEqual([]);
      expect(withStateLock(stateDir, () => "taken", 0)).toBe("taken");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("a link that keeps failing is tried a bounded number of times, then reported as wedged with its errno", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "dh-lock-wedge-"));
    try {
      let tries = 0;
      const link = (from: string, to: string) => {
        if (from.includes("free")) {
          tries += 1;
          throw failing("EIO");
        }
        linkSync(from, to);
      };
      const wedged: string[] = [];
      expect(
        withStateLock(stateDir, () => "value", 1_000, undefined, {
          link,
          wedged: (error) => wedged.push((error as NodeJS.ErrnoException).code ?? ""),
        }),
      ).toBe("value");
      expect(tries).toBe(3);
      expect(wedged).toEqual(["EIO"]);
      // The holder's generation is never removed: the highest one must not go back.
      const held = readdirSync(join(stateDir, "state.lock")).filter((name) => /^[0-9]+$/.test(name));
      expect(held).toHaveLength(1);
      expect(readFileSync(join(stateDir, "state.lock", held[0] ?? ""), "utf8")).toStartWith(`${process.pid} `);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
