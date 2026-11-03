import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const FIXTURES = join(import.meta.dir, "fixtures");

interface Outcome {
  readonly name: string;
  readonly passed: boolean;
  readonly ms: number;
}

/**
 * Runs one fixture file under `bun test` and reads each test's outcome line. The fixtures directory holds no bunfig, so
 * no repository's test path patterns apply, and a `./` path is taken as a path, not as a name filter.
 */
async function run(
  fixture: string,
): Promise<{ readonly outcomes: Outcome[]; readonly unnamed: number; readonly output: string }> {
  const proc = Bun.spawn([process.execPath, "test", `./${fixture}`], {
    cwd: FIXTURES,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  await proc.exited;
  const lines = `${stdout}\n${stderr}`.split("\n");
  const outcomes = lines.flatMap((line) => {
    const match = /^\((pass|fail)\) (.+) \[([\d.]+)ms\]$/.exec(line);
    return match?.[1] === undefined || match[2] === undefined || match[3] === undefined
      ? []
      : [{ name: match[2], passed: match[1] === "pass", ms: Number(match[3]) }];
  });
  return {
    outcomes,
    unnamed: outcomes.filter((outcome) => outcome.name === "(unnamed)").length,
    output: lines.join("\n"),
  };
}

describe("setUpOnce", () => {
  test("a set-up that rejects fails every test under its own name", async () => {
    const { outcomes, unnamed } = await run("set-up-once-rejects.fixture.ts");
    expect(outcomes.map(({ name, passed }) => ({ name, passed }))).toEqual([
      { name: "first", passed: false },
      { name: "second", passed: false },
    ]);
    expect(unnamed).toBe(0);
  }, 30_000);

  test("a set-up that never settles fails the first test at its timeout and the rest at once", async () => {
    const { outcomes, unnamed } = await run("set-up-once-hangs.fixture.ts");
    expect(outcomes.map(({ name, passed }) => ({ name, passed }))).toEqual([
      { name: "first", passed: false },
      { name: "second", passed: false },
      { name: "third", passed: false },
    ]);
    expect(outcomes.slice(1).every(({ ms }) => ms < 500)).toBe(true);
    expect(unnamed).toBe(0);
  }, 30_000);

  test("a set-up that throws synchronously runs once and fails every test under its own name", async () => {
    const { outcomes, unnamed, output } = await run("set-up-once-throws.fixture.ts");
    expect(outcomes.map(({ name, passed }) => ({ name, passed }))).toEqual([
      { name: "first", passed: false },
      { name: "second", passed: false },
    ]);
    expect(output.match(/^set-up ran$/gm)).toHaveLength(1);
    expect(unnamed).toBe(0);
  }, 30_000);
});
