import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hcCoreReader, readHcCore } from "./hc-core.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const HELLO_REPLY = '{"jsonrpc":"2.0","id":0,"result":{"core":{"id":"core-1","name":"alpha"}}}';

/** A stand-in for `hc`: runs `body` as a shell script, with `$0` its own path. */
function fakeHc(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "dh-hc-core-"));
  dirs.push(dir);
  const hc = join(dir, "hc");
  writeFileSync(hc, `#!/bin/sh\n${body}\n`);
  chmodSync(hc, 0o755);
  return hc;
}

describe("reading the herdr core", () => {
  test("a failed read is not kept: the next call asks hc connect again", async () => {
    const hc = fakeHc(`if [ -e "$0.ok" ]; then read line; echo '${HELLO_REPLY}'; else : > "$0.ok"; fi`);
    const core = hcCoreReader({ hc });
    expect(
      await core().then(
        () => "read",
        () => "failed",
      ),
    ).toBe("failed");
    expect(await core()).toEqual({ id: "core-1", name: "alpha" });
  });

  test("a core that never answers the hello fails at the timeout instead of hanging", async () => {
    const hc = fakeHc("exec sleep 30");
    const read = readHcCore({ hc, timeoutMs: 50 }).then(
      () => "read",
      (error: unknown) => String(error),
    );
    expect(await read).toContain("answered no hello with a core");
  });
});
