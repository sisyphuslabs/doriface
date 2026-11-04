import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseStartupErrorLine, STARTUP_EXIT_CODES, type StartupErrorReport } from "./startup-error.ts";
import { resolveHcBin } from "./testing/hc-session.ts";

const CLI = join(import.meta.dir, "cli.ts");
setDefaultTimeout(30_000);

const dirs: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "dh-startup-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Exit {
  readonly code: number;
  readonly stderr: string;
  readonly reports: readonly StartupErrorReport[];
}

async function serve(args: readonly string[]): Promise<Exit> {
  const stateDir = join(scratch(), "state");
  const proc = Bun.spawn([process.execPath, CLI, "--no-relay", "--state-dir", stateDir, ...args], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  const reports = stderr.split("\n").flatMap((line) => parseStartupErrorLine(line) ?? []);
  return { code, stderr, reports };
}

describe("a host that cannot start", () => {
  test("with no hc at the given path reports hc-binary-missing with that path, not the usage", async () => {
    const missing = join(scratch(), "no-such-hc");
    const exit = await serve(["--listen", "127.0.0.1:0", "--hc", missing]);
    expect(exit.code).toBe(STARTUP_EXIT_CODES["hc-binary-missing"]);
    expect(exit.reports).toEqual([expect.objectContaining({ code: "hc-binary-missing", path: missing })]);
    expect(exit.stderr).not.toContain("usage:");
  });

  test("with no hc on PATH reports hc-binary-missing for the bare name", async () => {
    const exit = await serve(["--listen", "127.0.0.1:0", "--hc", "doriface-no-such-hc"]);
    expect(exit.code).toBe(STARTUP_EXIT_CODES["hc-binary-missing"]);
    expect(exit.reports).toEqual([expect.objectContaining({ code: "hc-binary-missing", path: "doriface-no-such-hc" })]);
  });

  test.skipIf(process.platform === "win32")(
    "with an hc it may not run reports permission-denied with its path",
    async () => {
      const locked = join(scratch(), "hc");
      writeFileSync(locked, "#!/bin/sh\necho hc 0.1.17\n", { mode: 0o644 });
      const exit = await serve(["--listen", "127.0.0.1:0", "--hc", locked]);
      expect(exit.code).toBe(STARTUP_EXIT_CODES["permission-denied"]);
      expect(exit.reports).toEqual([expect.objectContaining({ code: "permission-denied", path: locked })]);
    },
  );

  test("with an hc that is not herdr-core reports hc-version-failed", async () => {
    const other = join(scratch(), "hc");
    writeFileSync(other, "#!/bin/sh\necho 'not herdr' >&2\nexit 1\n", { mode: 0o755 });
    const exit = await serve(["--listen", "127.0.0.1:0", "--hc", other]);
    expect(exit.code).toBe(STARTUP_EXIT_CODES["hc-version-failed"]);
    expect(exit.reports).toEqual([expect.objectContaining({ code: "hc-version-failed", path: other })]);
  });

  test("on a port another listener holds reports port-in-use with the address", async () => {
    const taken = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    try {
      const address = `127.0.0.1:${String(taken.port)}`;
      const exit = await serve(["--listen", address, "--hc", resolveHcBin()]);
      expect(exit.code).toBe(STARTUP_EXIT_CODES["port-in-use"]);
      expect(exit.reports).toEqual([expect.objectContaining({ code: "port-in-use", address })]);
      expect(exit.stderr).not.toContain("usage:");
    } finally {
      await taken.stop(true);
    }
  });

  test("a non-loopback --listen without --unsafe-listen is a refused command line: exit 2 with the usage", async () => {
    const exit = await serve(["--listen", "0.0.0.0:7766", "--hc", join(scratch(), "no-such-hc")]);
    expect(exit.code).toBe(2);
    expect(exit.stderr).toContain("--unsafe-listen");
    expect(exit.stderr).toContain("usage: doriface-host");
    expect(exit.reports).toEqual([]);
  });

  test("a command line it does not accept still exits 2 with the usage", async () => {
    const exit = await serve(["--no-such-flag"]);
    expect(exit.code).toBe(2);
    expect(exit.stderr).toContain("usage: doriface-host");
    expect(exit.reports).toEqual([]);
  });
});
