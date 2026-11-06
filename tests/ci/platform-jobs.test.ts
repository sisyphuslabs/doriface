import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Job = {
  if?: string;
  "runs-on"?: string;
  strategy?: { matrix?: { include?: Array<{ runner?: string }> } };
};
type Workflow = { on: { push?: { branches?: string[] }; pull_request?: unknown }; jobs: Record<string, Job> };

const ci = Bun.YAML.parse(
  readFileSync(join(import.meta.dir, "..", "..", ".github", "workflows", "ci.yml"), "utf8"),
) as Workflow;

const PLATFORM_RUNNER = /^(windows|macos)-/;

// Desktop, Windows and macOS jobs prove a change once it has merged to dev, never on the pull request itself.
function isPlatformJob(id: string, job: Job): boolean {
  const runners = [job["runs-on"] ?? "", ...(job.strategy?.matrix?.include ?? []).map((row) => row.runner ?? "")];
  return id.startsWith("desktop") || runners.some((runner) => PLATFORM_RUNNER.test(runner));
}

const platformJobs = Object.entries(ci.jobs).filter(([id, job]) => isPlatformJob(id, job));

test("the desktop, Windows and macOS jobs run only on a push to dev", () => {
  expect(ci.on.push?.branches).toEqual(["dev"]);
  expect(platformJobs.map(([id]) => id)).toEqual(
    expect.arrayContaining(["desktop", "desktop-macos", "windows-private-state"]),
  );
  for (const [id, job] of platformJobs) {
    const condition = job.if ?? "";
    const onlyOnPush =
      condition.includes("github.event_name == 'push'") &&
      !condition.includes("||") &&
      !/pull_request|merge_group/.test(condition);
    expect({ id, onlyOnPush }).toEqual({ id, onlyOnPush: true });
  }
});

test("Check, Relay e2e and Web e2e still run on every pull request", () => {
  expect(ci.on).toHaveProperty("pull_request");
  for (const id of ["check", "relay-e2e", "web-e2e"]) {
    expect({ id, found: id in ci.jobs, if: ci.jobs[id]?.if }).toEqual({ id, found: true, if: undefined });
  }
});
