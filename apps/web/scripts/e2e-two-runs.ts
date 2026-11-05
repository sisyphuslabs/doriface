/**
 * Runs two e2e suites at once in this checkout, as two sessions on one computer would, and fails unless both pass
 * (#37). Each run picks its own ports (e2e/run-ports.ts), so neither may find the other's host or web server in its way.
 * CI runs it after the full suite: `bun run test:e2e:two-runs`.
 */
import { join } from "node:path";

const WEB = join(import.meta.dir, "..");
/** A short spec that still starts every server of a run: both e2e hosts' setup, the web build and a worker host. */
const SPEC = "e2e/phone-empty.e2e.ts";

function run(name: string): Promise<{ readonly name: string; readonly status: number; readonly output: string }> {
  const env: Record<string, string | undefined> = { ...process.env, E2E_OUTPUT_DIR: `test-results/two-runs-${name}` };
  for (const port of ["E2E_HOST_PORT", "E2E_WEB_PORT", "E2E_LAYOUT_PORT"]) delete env[port];
  const child = Bun.spawn(["bunx", "playwright", "test", SPEC, "--workers", "2", "--reporter", "line"], {
    cwd: WEB,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]).then(
    ([stdout, stderr, status]) => ({ name, status, output: stdout + stderr }),
  );
}

const runs = await Promise.all([run("a"), run("b")]);
for (const { name, status, output } of runs) {
  console.log(`--- run ${name}: exit ${status}`);
  if (status !== 0) console.log(output);
}
const failed = runs.filter((result) => result.status !== 0).map((result) => result.name);
if (failed.length > 0) {
  console.error(`two e2e runs at once: run ${failed.join(" and ")} failed`);
  process.exit(1);
}
console.log("two e2e runs at once: both passed");
