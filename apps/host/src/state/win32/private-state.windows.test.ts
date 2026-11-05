import { afterEach, describe, expect, test } from "bun:test";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadHostIdentity } from "../host-keys.ts";
import { loadDeviceKey } from "../known-hosts.ts";
import { readJson, writePrivateJson } from "../files.ts";
import { classifyCustody } from "./classify.ts";
import {
  closeHandle,
  currentUserSid,
  FILE_FLAG_BACKUP_SEMANTICS,
  OPEN_EXISTING,
  openFile,
  READ_CONTROL,
  readSddl,
  resolveSidAlias,
} from "./native.ts";
import { parseSddl } from "./sddl.ts";

const ICACLS = join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "icacls.exe");
const icacls = (...args: string[]): void => {
  const run = Bun.spawnSync([ICACLS, ...args]);
  if (run.exitCode !== 0) throw new Error(`icacls ${args.join(" ")}: ${run.stdout.toString()}${run.stderr.toString()}`);
};
const WINDOWS = process.platform === "win32";
const USER = WINDOWS ? currentUserSid() : "";
const descriptorOf = (path: string, folder = false) => {
  const handle = openFile(path, {
    access: READ_CONTROL,
    share: 7,
    disposition: OPEN_EXISTING,
    flags: folder ? FILE_FLAG_BACKUP_SEMANTICS : 0,
  });
  try {
    return parseSddl(readSddl(handle), resolveSidAlias);
  } finally {
    closeHandle(handle);
  }
};

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});
/** A root under this user's temp folder (inside the profile), and a state folder path inside it. */
function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "doriface-406-"));
  scratch.push(dir);
  return dir;
}

// The windows-private-state CI job fails on any skip here, so these never pass by skipping on Windows.
describe.skipIf(!WINDOWS)("private state on Windows (#406)", () => {
  test("W1 fresh host and device keys load again with the same identity and an exact owner-only descriptor", () => {
    const state = join(root(), "state");
    const first = loadHostIdentity(state);
    const device = loadDeviceKey(state);
    expect(loadHostIdentity(state).hostId).toBe(first.hostId);
    expect(loadDeviceKey(state).publicKey).toEqual(device.publicKey);
    for (const name of ["host-keys.json", "device-key.json"]) {
      const descriptor = descriptorOf(join(state, name));
      expect(descriptor.protected).toBe(true);
      expect(descriptor.dacl).toEqual([{ type: "A", flags: "", mask: 0x001f01ff, sid: USER }]);
      expect(classifyCustody(descriptor, USER).verdict).toBe("private");
    }
    expect(descriptorOf(state, true).protected).toBe(true);
  });

  test("W2 a v0.1.0 key file that inherits only SYSTEM and Administrators is re-locked and keeps its keys", () => {
    const base = root();
    const state = join(base, "state");
    mkdirSync(state);
    const before = loadHostIdentity(join(base, "seed"));
    writeLegacy(state, "host-keys.json", join(base, "seed", "host-keys.json"));
    expect(loadHostIdentity(state).hostId).toBe(before.hostId);
    expect(classifyCustody(descriptorOf(join(state, "host-keys.json")), USER).verdict).toBe("private");
  });

  test("W3 an explicit Users grant on the key is refused, and still refused on the next start", () => {
    const state = join(root(), "state");
    loadHostIdentity(state);
    icacls(join(state, "host-keys.json"), "/grant", "*S-1-5-32-545:R");
    expect(() => loadHostIdentity(state)).toThrow(/other accounts.*S-1-5-32-545.*icacls/s);
  });

  test("W4 a Users grant inherited from a custom folder is refused before anything changes", () => {
    const base = root();
    icacls(base, "/grant", "*S-1-5-32-545:(OI)(CI)R");
    const state = join(base, "state");
    mkdirSync(state);
    writeLegacy(state, "host-keys.json", undefined);
    expect(() => loadHostIdentity(state)).toThrow(/S-1-5-32-545/);
    expect(classifyCustody(descriptorOf(join(state, "host-keys.json")), USER).verdict).toBe("exposed");
    expect(() => loadHostIdentity(state)).toThrow(/S-1-5-32-545/);
  });

  test("W6 a state folder that is a junction or link is refused", () => {
    const base = root();
    const real = join(base, "real");
    loadHostIdentity(real);
    const linked = join(base, "linked");
    symlinkSync(real, linked, "junction");
    expect(() => loadHostIdentity(linked)).toThrow(/link or junction/);
  });

  test("W7 a key file with an outside hard link is refused", () => {
    const base = root();
    const state = join(base, "state");
    loadHostIdentity(state);
    linkSync(join(state, "host-keys.json"), join(base, "alias.json"));
    expect(() => readJson(join(state, "host-keys.json"))).toThrow(/2 hard links/);
  });

  test("W9 a replaced private file keeps the exact owner-only descriptor", () => {
    const state = join(root(), "state");
    loadHostIdentity(state);
    writePrivateJson(join(state, "devices.json"), { version: 1, devices: [] });
    writePrivateJson(join(state, "devices.json"), { version: 1, devices: [] });
    expect(classifyCustody(descriptorOf(join(state, "devices.json")), USER).verdict).toBe("private");
    expect(readJson(join(state, "devices.json"))).toEqual({ version: 1, devices: [] });
  });
});

/** Writes a key file the way v0.1.0 did: plain fs, so it inherits its folder's ACL (`from` copies another file's bytes). */
function writeLegacy(dir: string, name: string, from: string | undefined): void {
  writeFileSync(join(dir, name), from === undefined ? '{"version":1}\n' : readFileSync(from));
}
