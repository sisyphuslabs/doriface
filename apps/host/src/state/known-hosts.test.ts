import { base64urlEncode, generateHostIdentity, generateX25519 } from "@doriface/crypto";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXPOSED_REFUSAL, exposeToOthers, isOwnerOnly } from "../testing/private-file.ts";
import { KnownHosts, loadDeviceKey } from "./known-hosts.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dh-known-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("this machine's device key", () => {
  test("is generated once, kept owner-only, and loads the same afterwards", () => {
    const first = loadDeviceKey(dir);
    expect(isOwnerOnly(join(dir, "device-key.json"))).toBe(true);
    expect(loadDeviceKey(dir)).toEqual(first);
  });

  test("a key file others can read is refused, not used", () => {
    loadDeviceKey(dir);
    exposeToOthers(join(dir, "device-key.json"), "644");
    expect(() => loadDeviceKey(dir)).toThrow(EXPOSED_REFUSAL);
  });
});

describe("KnownHosts", () => {
  test("a paired host survives a new store on the same dir, and unknown hosts are undefined", () => {
    const hostKey = generateX25519().publicKey;
    const host = { hostId: "a".repeat(26), hostKey, relayUrl: "wss://relay.example" };
    new KnownHosts(dir).add(host);
    const reloaded = new KnownHosts(dir);
    expect(reloaded.get(host.hostId)).toEqual(host);
    expect(reloaded.get("b".repeat(26))).toBeUndefined();
    expect(isOwnerOnly(join(dir, "known-hosts.json"))).toBe(true);
  });

  test("pairing the same host again replaces its record", () => {
    const store = new KnownHosts(dir);
    const hostId = "c".repeat(26);
    store.add({ hostId, hostKey: generateX25519().publicKey, relayUrl: "wss://one.example" });
    store.add({ hostId, hostKey: generateX25519().publicKey, relayUrl: "wss://two.example" });
    expect(new KnownHosts(dir).get(hostId)?.relayUrl).toBe("wss://two.example");
  });
});

const WORKER = join(import.meta.dir, "..", "testing", "known-hosts-worker.ts");

describe("KnownHosts under the state lock", () => {
  test("an add waits for the state lock another live process holds, and writes nothing while it is held", () => {
    writeFileSync(join(dir, "state.lock"), `${process.pid} holder-token`);
    const host = generateHostIdentity();
    const store = new KnownHosts(dir, { lockTimeoutMs: 50 });
    expect(() =>
      store.add({ hostId: host.hostId, hostKey: host.noise.publicKey, relayUrl: "wss://r.example" }),
    ).toThrow("locked");
    expect(existsSync(join(dir, "known-hosts.json"))).toBe(false);
  });

  test("four processes pairing hosts at once lose no record", async () => {
    const workers = ["a", "b", "c", "d"].map(() =>
      Bun.spawn([process.execPath, WORKER, "add", dir, "15"], { stdout: "pipe", stderr: "pipe" }),
    );
    const outputs = await Promise.all(workers.map((worker) => new Response(worker.stdout).text()));
    expect(await Promise.all(workers.map((worker) => worker.exited))).toEqual([0, 0, 0, 0]);
    const added = outputs.flatMap((output) => output.trim().split("\n"));
    const store = new KnownHosts(dir);
    expect(added).toHaveLength(60);
    expect(added.filter((hostId) => store.get(hostId) === undefined)).toEqual([]);
  }, 30_000);

  test("two processes pairing one host with different keys at once: one saves, the other is refused with the notice", async () => {
    const hostId = generateHostIdentity().hostId;
    const decoder = new TextDecoder();
    const workers = [0, 1].map(() => {
      const proc = Bun.spawn([process.execPath, WORKER, "pair", dir, hostId], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      const reader = proc.stdout.getReader();
      let output = "";
      /** Reads this worker's stdout until it has said `line`, or to its end when `line` is undefined. */
      const read = async (line?: string): Promise<string> => {
        if (line !== undefined && output.split("\n").includes(line)) return output;
        const { value, done } = await reader.read();
        if (done) {
          if (line === undefined) return output;
          throw new Error(`a worker ended before "${line}": ${output}`);
        }
        output += decoder.decode(value);
        return read(line);
      };
      return { proc, read };
    });
    // Both have checked the saved record (none) before either saves, as two pairings started at the same moment do.
    await Promise.all(workers.map(({ read }) => read("checked")));
    await Promise.all(
      workers.map(({ proc }) => {
        proc.stdin.write("go\n");
        return proc.stdin.end();
      }),
    );
    const ends = await Promise.all(
      workers.map(async ({ proc, read }) => ({
        code: await proc.exited,
        stdout: await read(),
        stderr: await new Response(proc.stderr).text(),
      })),
    );
    expect(ends.map(({ code }) => code).toSorted()).toEqual([0, 1]);
    const winner = ends.find(({ code }) => code === 0);
    const loser = ends.find(({ code }) => code === 1);
    const savedKey = winner?.stdout.match(/^saved (\S+)$/m)?.[1];
    expect(savedKey).toBeDefined();
    const stored = new KnownHosts(dir).get(hostId);
    expect(stored === undefined ? undefined : base64urlEncode(stored.hostKey)).toBe(savedKey);
    expect(loser?.stderr).toContain(`host key changed for ${hostId}`);
    expect(loser?.stderr).toContain("--replace");
    expect(loser?.stdout).not.toContain("saved");
  }, 30_000);
});
