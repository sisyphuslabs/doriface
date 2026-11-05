import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXPOSED_REFUSAL, exposeToOthers, makePrivateAgain } from "../testing/private-file.ts";
import { loadHostIdentity } from "./host-keys.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dh-keys-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("host keys", () => {
  test.each(["644", "640", "604"] as const)(
    "a keys file opened to others (POSIX mode %s) is refused, not loaded",
    (mode) => {
      const created = loadHostIdentity(dir);
      const path = join(dir, "host-keys.json");
      exposeToOthers(path, mode);
      expect(() => loadHostIdentity(dir)).toThrow(EXPOSED_REFUSAL);
      makePrivateAgain(path, mode);
      expect(loadHostIdentity(dir).hostId).toBe(created.hostId);
    },
  );
});
