import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUN_DIR } from "./run-cores.ts";

setDefaultTimeout(120_000);

const APPS = join(import.meta.dir, "../../..");

interface Run {
  readonly code: number;
  readonly output: string;
  /** The scratch dirs (`dh-*`) the run left in its $TMPDIR. */
  readonly left: readonly string[];
  /** Whether a core still answered, once the run was over, on the socket the restart fixture left. */
  readonly stillServing: boolean;
}

/** `bun test <file>` started from `cwd` as a person would start it there, in its own $TMPDIR. */
async function testRun(cwd: string, file: string): Promise<Run> {
  const tmp = mkdtempSync(join(tmpdir(), "dt-"));
  try {
    const env: Record<string, string | undefined> = { ...process.env, TMPDIR: tmp };
    // The outer run's record of what it leaves running is its own.
    delete env[RUN_DIR];
    const proc = Bun.spawn([process.execPath, "test", file], { cwd, env, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const output = out + err;
    const left = readdirSync(tmp).filter((name) => name.startsWith("dh-"));
    const socket = /^LEFT (\S+)$/m.exec(output)?.[1];
    // A core the run failed to stop is stopped here, before its socket's dir goes, so a failing check leaks nothing.
    const stillServing = socket !== undefined && (await stopIfServing(socket));
    return { code, output, left, stillServing };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Stops the core answering on `socket`, if one does (a raw connect starts nothing); whether one did. */
async function stopIfServing(socket: string): Promise<boolean> {
  const closed = Promise.withResolvers<void>();
  try {
    const held = await Bun.connect({ unix: socket, socket: { data: () => {}, close: () => closed.resolve() } });
    held.write('{"jsonrpc":"2.0","id":1,"method":"server.stop"}\n');
    await closed.promise;
    return true;
  } catch {
    return false;
  }
}

const places = [
  { name: "the host package", cwd: join(APPS, "host"), dir: "./src/testing/fixtures" },
  { name: "a folder inside it, where no bunfig is read", cwd: join(APPS, "host/src"), dir: "./testing/fixtures" },
  { name: "the desktop package", cwd: join(APPS, "desktop"), dir: "./test/fixtures" },
] as const;

test.each(places)("a run from $name leaves no scratch dir behind (#153)", async ({ cwd, dir }) => {
  const run = await testRun(cwd, `${dir}/dispose.fixture.ts`);
  expect(run.code, run.output).toBe(0);
  expect(run.left).toEqual([]);
});

test.each(places.filter((place) => place.dir !== "./testing/fixtures"))(
  "a run from $name stops and reports a core that outlived its test, and leaves no scratch dir (#153)",
  async ({ cwd, dir }) => {
    const run = await testRun(cwd, `${dir}/restart.fixture.ts`);
    expect(run.output).toContain("LEFT ");
    expect(run.output).toContain("herdr-core outlived the test that started it");
    expect(run.code).not.toBe(0);
    expect(run.left).toEqual([]);
    expect(run.stillServing).toBe(false);
  },
);
