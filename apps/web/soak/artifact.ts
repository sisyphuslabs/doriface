/**
 * Waits for an artifact another job of this workflow run uploads, then downloads it: the soak's host and clients run on
 * different runners and meet only through the run's artifacts. Needs GH_TOKEN (actions: read), GITHUB_REPOSITORY and
 * GITHUB_RUN_ID, as a workflow step has them.
 *
 *   bun soak/artifact.ts <name> <dir> <timeout seconds>
 */
const [name, dir, timeout] = process.argv.slice(2);
if (name === undefined || dir === undefined || timeout === undefined) {
  throw new Error("usage: artifact.ts <name> <dir> <timeout seconds>");
}
const run = process.env["GITHUB_RUN_ID"];
const repo = process.env["GITHUB_REPOSITORY"];
if (run === undefined || repo === undefined) throw new Error("GITHUB_RUN_ID and GITHUB_REPOSITORY must be set");

const deadline = Date.now() + Number(timeout) * 1000;
const POLL_MS = 10_000;

async function listed(): Promise<boolean> {
  const proc = Bun.spawn(
    ["gh", "api", `repos/${repo}/actions/runs/${run}/artifacts?name=${name}`, "--jq", ".total_count"],
    {
      stdout: "pipe",
      stderr: "inherit",
    },
  );
  const count = (await new Response(proc.stdout).text()).trim();
  return (await proc.exited) === 0 && Number(count) > 0;
}

async function download(): Promise<void> {
  const proc = Bun.spawn(
    ["gh", "run", "download", run ?? "", "--repo", repo ?? "", "--name", name ?? "", "--dir", dir ?? ""],
    {
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if ((await proc.exited) !== 0) throw new Error(`could not download the artifact ${name}`);
}

async function waitFor(): Promise<void> {
  if (await listed()) return download();
  if (Date.now() > deadline) throw new Error(`no artifact ${name} within ${timeout} s`);
  // An external service's state, polled: nothing to subscribe to across runners.
  await Bun.sleep(POLL_MS);
  return waitFor();
}

await waitFor();
console.log(`artifact ${name} in ${dir}`);
