import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Step = { name?: string; run?: string; uses?: string };
type Job = { needs?: string; if?: string; steps: Step[] };
type Workflow = { jobs: Record<string, Job> };
type Route = { pattern: string; custom_domain?: boolean };
type Assets = { directory: string; not_found_handling?: string };
type Wrangler = { assets: Assets; routes: Route[]; env: { staging: { assets: Assets; routes: Route[] } } };

const ROOT = join(import.meta.dir, "..", "..");
const workflow = Bun.YAML.parse(readFileSync(join(ROOT, ".github", "workflows", "deploy-web.yml"), "utf8")) as Workflow;
const wrangler = Bun.JSONC.parse(readFileSync(join(ROOT, "apps", "web", "wrangler.jsonc"), "utf8")) as Wrangler;

const runs = (job: Job): string[] => job.steps.flatMap((step) => (step.run === undefined ? [] : [step.run]));

test("production deploys only from dev, after staging was deployed and probed, from staging's own build", () => {
  const { staging, production } = workflow.jobs;
  if (staging === undefined || production === undefined) throw new Error("deploy-web.yml lacks a job");
  expect(production.needs).toBe("staging");
  expect(production.if).toContain("github.ref == 'refs/heads/dev'");
  expect(runs(staging)).toEqual(
    expect.arrayContaining([
      'bunx "$WRANGLER" deploy --env staging',
      "bun .github/scripts/probe-web.ts https://doriface-staging.omo.dev",
    ]),
  );
  expect(runs(staging)).not.toContain('bunx "$WRANGLER" deploy --env ""');
  expect(runs(production)).toEqual([
    'bunx "$WRANGLER" deploy --env ""',
    "bun .github/scripts/probe-web.ts https://doriface.omo.dev",
  ]);
  expect(production.steps.some((step) => step.uses?.startsWith("actions/download-artifact"))).toBe(true);
});

test("both hostnames serve the build with the SPA fallback, so /pair loads the app", () => {
  expect(wrangler.routes).toEqual([{ pattern: "doriface.omo.dev", custom_domain: true }]);
  expect(wrangler.env.staging.routes).toEqual([{ pattern: "doriface-staging.omo.dev", custom_domain: true }]);
  for (const assets of [wrangler.assets, wrangler.env.staging.assets]) {
    expect(assets).toEqual({ directory: "./dist", not_found_handling: "single-page-application" });
  }
});
