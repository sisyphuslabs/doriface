import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadHostIdentity } from "./host-keys.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dh-keys-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("host keys", () => {
  // POSIX mode bits; on Windows the same refusal is the ACL check (private-state.windows.test.ts W3).
  test.skipIf(process.platform === "win32").each(["644", "640", "604"])(
    "a keys file with mode %s is refused, not loaded",
    (mode) => {
      const created = loadHostIdentity(dir);
      chmodSync(join(dir, "host-keys.json"), Number.parseInt(mode, 8));
      expect(() => loadHostIdentity(dir)).toThrow("readable by other users");
      chmodSync(join(dir, "host-keys.json"), 0o600);
      expect(loadHostIdentity(dir).hostId).toBe(created.hostId);
    },
  );
});
