import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LockSteps, type StepWorker } from "../testing/lock-steps.ts";
import { withStateLock } from "./lock.ts";

let dir: string;
let steps: LockSteps;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dh-lock-steps-"));
  steps = new LockSteps(dir);
});
afterEach(async () => {
  await steps.stop();
  rmSync(dir, { recursive: true, force: true });
});

/** A pid that is no longer running: a child that already exited. */
function deadPid(): number {
  const child = Bun.spawnSync(["sh", "-c", "echo $$"], { stdout: "pipe" });
  return Number(child.stdout.toString().trim());
}

const lockDir = () => join(dir, "state.lock");
/** The lock directory's entries and the content of each generation. */
const entries = () =>
  Object.fromEntries(readdirSync(lockDir()).map((name) => [name, readFileSync(join(lockDir(), name), "utf8")]));

/** Lets `worker` go step by step, expecting it to stop at each of `expected` in turn. */
async function goThrough(worker: StepWorker, expected: readonly string[]): Promise<void> {
  const [step, ...rest] = expected;
  if (step === undefined) return;
  expect(await worker.go()).toBe(step);
  await goThrough(worker, rest);
}

describe("state lock generations (#23)", () => {
  test("a holder that died, four racers stopped between finding it dead and publishing, and a late arrival: one holder at a time", async () => {
    const a = steps.spawn("A");
    expect(await a.next()).toBe("observed 0");
    expect(await a.go()).toBe("published 1");
    expect(await a.go()).toBe("acquired 1");
    await a.kill();

    const [b, c, d, f] = ["B", "C", "D", "F"].map((name) => steps.spawn(name));
    if (b === undefined || c === undefined || d === undefined || f === undefined) throw new Error("unreachable");
    expect(await Promise.all([b, c, d, f].map((racer) => racer.next()))).toEqual(Array(4).fill("observed 1"));

    expect(await b.go()).toBe("published 2");
    expect(await c.go()).toBe("waiting 2");
    expect(await b.go()).toBe("acquired 2");
    expect(await b.go()).toBe("released 3");
    expect(await b.go()).toBe("done");

    expect(await c.go()).toBe("observed 3");
    expect(await c.go()).toBe("published 4");
    expect(await c.go()).toBe("acquired 4");

    // D and F still act on the dead generation 1 they saw. Generation 2 was taken, released and removed, so D wins the
    // number 2 again; it finds 4 above it and backs off. F wins it next and dies there, inside the window.
    expect(await d.go()).toBe("published 2");
    expect(await d.go()).toBe("stale 2");
    expect(await d.go()).toBe("waiting 4");
    expect(await f.go()).toBe("published 2");
    await f.kill();

    const e = steps.spawn("E");
    expect(await e.next()).toBe("waiting 4");
    expect(await c.go()).toBe("released 5");
    expect(await c.go()).toBe("done");
    expect(await e.go()).toBe("observed 5");
    expect(await e.go()).toBe("published 6");
    expect(await d.go()).toBe("waiting 6");
    expect(await e.go()).toBe("acquired 6");
    expect(Object.keys(entries())).toEqual(["6"]);
    expect(await e.go()).toBe("released 7");
    expect(await e.go()).toBe("done");
    expect(await d.go()).toBe("observed 7");
    expect(await d.go()).toBe("published 8");
    expect(await d.go()).toBe("acquired 8");
    expect(await d.go()).toBe("released 9");
    expect(await d.go()).toBe("done");

    expect(steps.maxHolders).toBe(1);
    expect(entries()).toEqual({ "9": "free" });
  });

  test("a live holder is waited for, and taken over only once it releases", async () => {
    const a = steps.spawn("A");
    expect(await a.next()).toBe("observed 0");
    expect(await a.go()).toBe("published 1");
    expect(await a.go()).toBe("acquired 1");
    expect(() => withStateLock(dir, () => undefined, 30)).toThrow("locked");
    expect(await a.go()).toBe("released 2");
    expect(await a.go()).toBe("done");
    expect(withStateLock(dir, () => "ran", 30)).toBe("ran");
  });

  for (const [crash, reached] of [
    ["before it published", ["observed 0"]],
    ["after it published, before it checked for a newer generation", ["observed 0", "published 1"]],
    ["while it held the lock", ["observed 0", "published 1", "acquired 1"]],
    [
      "after it published the free generation, before it removed its own",
      ["observed 0", "published 1", "acquired 1", "released 2"],
    ],
  ] as const) {
    test(`a process that dies ${crash} does not keep the next one out, and leaves nothing behind it`, async () => {
      const a = steps.spawn("A");
      const [first, ...rest] = reached;
      expect(await a.next()).toBe(first);
      await goThrough(a, rest);
      await a.kill();
      expect(withStateLock(dir, () => "ran", 2000)).toBe("ran");
      expect(Object.values(entries())).toEqual(["free"]);
    });
  }

  test("a temp file left by a process that died publishing is swept; a live process's is not", () => {
    mkdirSync(lockDir());
    writeFileSync(join(lockDir(), "1"), `${deadPid()} dead-holder`);
    const dead = `2.${deadPid()}.${crypto.randomUUID()}.tmp`;
    const live = `2.${process.pid}.${crypto.randomUUID()}.tmp`;
    for (const name of [dead, live]) writeFileSync(join(lockDir(), name), "x");
    expect(withStateLock(dir, () => "ran", 2000)).toBe("ran");
    expect(Object.keys(entries()).toSorted()).toEqual(["3", live].toSorted());
  });
});
