import { base64urlEncode } from "@doriface/crypto";
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { legacyStateLock } from "../testing/lock-steps.ts";
import { DeviceStore } from "./devices.ts";
import { withStateLock } from "./lock.ts";

const WORKER = join(import.meta.dir, "..", "testing", "devices-worker.ts");
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dh-lock-"));
});
afterEach(() => {
  mock.restore();
  rmSync(dir, { recursive: true, force: true });
});

/** A pid that is no longer running: a child that already exited. */
function deadPid(): number {
  const child = Bun.spawnSync(["sh", "-c", "echo $$"], { stdout: "pipe" });
  return Number(child.stdout.toString().trim());
}

const probe = process.kill.bind(process);

/** Another process breaks the dead holder's lock and takes its own just as this one finds the holder dead. */
function whenFoundDead(pid: number, replace: () => void): void {
  let pending = true;
  spyOn(process, "kill").mockImplementation((target: number, signal?: string | number) => {
    if (pending && target === pid) {
      pending = false;
      replace();
    }
    return probe(target, signal);
  });
}

const rename = fs.renameSync;

/** A third process takes the lock path the instant this one renames whatever holds it. */
function whenLockMoved(path: string, take: () => void): void {
  spyOn(fs, "renameSync").mockImplementation((from: fs.PathLike, to: fs.PathLike) => {
    rename(from, to);
    if (from === path) take();
  });
}

const run = (...args: string[]) => Bun.spawn([process.execPath, WORKER, ...args], { stdout: "ignore", stderr: "pipe" });

describe("state lock, from a v0.1.0 lock file", () => {
  test("a lock whose holder has not written its pid yet is held, not broken", () => {
    const devices = new DeviceStore(dir, { lockTimeoutMs: 50 });
    devices.add(crypto.getRandomValues(new Uint8Array(32)), "phone");
    legacyStateLock(dir, "");
    expect(() => devices.revoke(devices.list()[0]?.clientStaticPub ?? "")).toThrow("locked");
    expect(devices.list()).toHaveLength(1);
  });

  test("a stale lock replaced by a live holder after it was read is waited for, never removed", () => {
    const path = join(dir, "state.lock");
    const dead = deadPid();
    const fresh = `${process.pid} fresh-token`;
    writeFileSync(path, `${dead} stale-token`);
    whenFoundDead(dead, () => writeFileSync(path, fresh));
    let ran = false;
    expect(() => withStateLock(dir, () => (ran = true), 50)).toThrow("locked");
    expect(ran).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(fresh);
  });

  test("a breaker that finds a newer live lock leaves it in place, so a third process cannot slip in beside it", () => {
    const path = join(dir, "state.lock");
    const dead = deadPid();
    const fresh = `${process.pid} fresh-token`;
    writeFileSync(path, `${dead} stale-token`);
    whenFoundDead(dead, () => writeFileSync(path, fresh));
    whenLockMoved(path, () => writeFileSync(path, `${process.pid} third-token`, { flag: "wx" }));
    expect(() => withStateLock(dir, () => undefined, 50)).toThrow("locked");
    expect(readFileSync(path, "utf8")).toBe(fresh);
    expect(fs.readdirSync(dir)).toEqual(["state.lock"]);
  });

  test("a breaker that died holding the break guard does not keep a stale lock from being broken", () => {
    legacyStateLock(dir, `${deadPid()} stale-token`);
    writeFileSync(join(dir, "state.lock.break"), `${deadPid()} breaker-token`);
    expect(withStateLock(dir, () => "ran", 200)).toBe("ran");
    expect(fs.readdirSync(dir)).toEqual(["state.lock"]);
    expect(
      fs.readdirSync(join(dir, "state.lock")).map((name) => readFileSync(join(dir, "state.lock", name), "utf8")),
    ).toEqual(["free"]);
  });

  test("a live breaker's guard is waited for", () => {
    legacyStateLock(dir, `${deadPid()} stale-token`);
    writeFileSync(join(dir, "state.lock.break"), `${process.pid} breaker-token`);
    expect(() => withStateLock(dir, () => undefined, 50)).toThrow("locked");
  });

  test("concurrent CLI-style adds and a revoke, starting from a dead holder's lock, lose no update", async () => {
    const seeded = new DeviceStore(dir);
    const revokeKeys = Array.from({ length: 15 }, (_, i) => {
      const key = crypto.getRandomValues(new Uint8Array(32));
      seeded.add(key, `seed-${i}`);
      return base64urlEncode(key);
    });
    legacyStateLock(dir, `${deadPid()} stale-token`);
    const workers = [
      ...["a", "b", "c", "d"].map((prefix) => run("add", dir, prefix, "15")),
      run("revoke", dir, ...revokeKeys),
    ];
    const codes = await Promise.all(workers.map((worker) => worker.exited));
    expect(codes).toEqual([0, 0, 0, 0, 0]);
    const names = seeded.list().map((device) => device.name);
    expect(names.filter((name) => name.startsWith("seed-"))).toEqual([]);
    expect(names.toSorted()).toEqual(
      ["a", "b", "c", "d"].flatMap((prefix) => Array.from({ length: 15 }, (_, i) => `${prefix}-${i}`)).toSorted(),
    );
  }, 30_000);
});
