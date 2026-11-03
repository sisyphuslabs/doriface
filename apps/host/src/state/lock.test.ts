import { base64urlEncode } from "@doriface/crypto";
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const run = (...args: string[]) => Bun.spawn([process.execPath, WORKER, ...args], { stdout: "ignore", stderr: "pipe" });

describe("state lock", () => {
  test("a lock whose holder has not written its pid yet is held, not broken", () => {
    const devices = new DeviceStore(dir, { lockTimeoutMs: 50 });
    devices.add(crypto.getRandomValues(new Uint8Array(32)), "phone");
    writeFileSync(join(dir, "state.lock"), "");
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

  test("concurrent CLI-style adds and a revoke, starting from a dead holder's lock, lose no update", async () => {
    const seeded = new DeviceStore(dir);
    const revokeKeys = Array.from({ length: 15 }, (_, i) => {
      const key = crypto.getRandomValues(new Uint8Array(32));
      seeded.add(key, `seed-${i}`);
      return base64urlEncode(key);
    });
    writeFileSync(join(dir, "state.lock"), `${deadPid()} stale-token`);
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
