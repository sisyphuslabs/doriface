import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRIVATE_STATE_REFUSED_EXIT_CODE } from "../state/private-state-refused.ts";
import { exposeToOthers } from "../testing/private-file.ts";

const CLI = join(import.meta.dir, "..", "cli.ts");
setDefaultTimeout(30_000);

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function fingerprint(stateDir: string) {
  const child = Bun.spawn([process.execPath, CLI, "fingerprint", "--state-dir", stateDir], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}

describe("doriface-host fingerprint (#406)", () => {
  test("prints the same fingerprint on two starts with one state folder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dh-fp-"));
    scratch.push(dir);
    const first = await fingerprint(dir);
    expect(first.code).toBe(0);
    expect(first.stdout).toMatch(/^([0-9A-F]{4} ){9}[0-9A-F]{4}\n$/);
    expect((await fingerprint(dir)).stdout).toBe(first.stdout);
  });

  test("a key file opened to others is refused with the file and the fix, never the usage, and not as exit 2", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dh-fp-"));
    scratch.push(dir);
    expect((await fingerprint(dir)).code).toBe(0);
    exposeToOthers(join(dir, "host-keys.json"), "644");
    const refused = await fingerprint(dir);
    expect(refused.code).toBe(PRIVATE_STATE_REFUSED_EXIT_CODE);
    expect(refused.stderr).toContain("host-keys.json");
    expect(refused.stderr).not.toContain("usage:");
    expect(refused.stdout).toBe("");
  });
});
