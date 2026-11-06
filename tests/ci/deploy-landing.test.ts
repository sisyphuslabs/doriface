import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Step = { name?: string; run?: string; uses?: string };
type Job = { needs?: string; if?: string; steps: Step[] };
type Workflow = { on: { push: { branches: string[] } }; jobs: Record<string, Job> };
type Route = { pattern: string; custom_domain?: boolean };
type Wrangler = { routes: Route[]; env: { staging: { routes: Route[] } } };

const ROOT = join(import.meta.dir, "..", "..");
const workflow = Bun.YAML.parse(
  readFileSync(join(ROOT, ".github", "workflows", "deploy-landing.yml"), "utf8"),
) as Workflow;
const wrangler = Bun.JSONC.parse(readFileSync(join(ROOT, "apps", "landing", "wrangler.jsonc"), "utf8")) as Wrangler;

const runs = (job: Job): string[] => job.steps.flatMap((step) => (step.run === undefined ? [] : [step.run]));

test("a push deploys and probes staging only; doriterm.com needs a manual run on dev after staging passed", () => {
  const { staging, production } = workflow.jobs;
  if (staging === undefined || production === undefined) throw new Error("deploy-landing.yml lacks a job");
  expect(runs(staging)).toEqual(
    expect.arrayContaining([
      'bunx "$WRANGLER" deploy --env staging',
      "bun .github/scripts/probe-landing.ts https://staging.doriterm.com",
    ]),
  );
  expect(runs(staging)).not.toContain('bunx "$WRANGLER" deploy --env ""');
  expect(production.needs).toBe("staging");
  expect(production.if).toContain("github.ref == 'refs/heads/dev'");
  expect(production.if).toContain("github.event_name == 'workflow_dispatch'");
  expect(production.if).toContain("inputs.production");
  expect(production.steps.some((step) => step.uses?.startsWith("actions/download-artifact"))).toBe(true);
});

test("production deploys only after app.doriterm.com, where every Open the app button points, answers", () => {
  const steps = runs(workflow.jobs["production"] ?? { steps: [] });
  const guard = steps.findIndex((run) => run.includes("https://app.doriterm.com"));
  const deploy = steps.indexOf('bunx "$WRANGLER" deploy --env ""');
  expect(guard).toBeGreaterThanOrEqual(0);
  expect(deploy).toBeGreaterThan(guard);
  expect(steps.at(-1)).toBe("bun .github/scripts/probe-landing.ts https://doriterm.com");
});

test("the apex serves the landing and staging.doriterm.com its staging copy", () => {
  expect(wrangler.routes).toEqual([{ pattern: "doriterm.com", custom_domain: true }]);
  expect(wrangler.env.staging.routes).toEqual([{ pattern: "staging.doriterm.com", custom_domain: true }]);
});
