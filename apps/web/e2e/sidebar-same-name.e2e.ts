import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { endAgent } from "./agents.ts";
import { expect, test } from "./fixtures.ts";
import { hcOn } from "./machine-switch.ts";
import { rows } from "./sidebar-measure.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

let dir = "";
const started: string[] = [];

function startIn(cwd: string, name: string): string {
  const out = hcOn("host", ["run", "--bg", "--name", name, "--cwd", cwd, "--", "sh", "-c", "exec sleep 600"]);
  const parsed: unknown = JSON.parse(out);
  if (typeof parsed !== "object" || parsed === null || !("address" in parsed)) throw new Error(out);
  const address = String(parsed.address);
  started.push(address);
  return address;
}

test.beforeAll(() => {
  dir = mkdtempSync(join(process.env["TMPDIR"] ?? tmpdir(), "same-name-"));
  for (const parent of ["home", "data"]) mkdirSync(join(dir, parent, "twin397"), { recursive: true });
});
test.afterEach(() => {
  for (const address of started.splice(0)) endAgent("host", address);
});
test.afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("two spaces with the same name on one machine are two rows, told apart, and the count says 2 (#397)", async ({
  page,
}) => {
  startIn(join(dir, "home", "twin397"), "twin-home");
  startIn(join(dir, "data", "twin397"), "twin-data");
  await page.goto("/");
  const spaces = page.getByRole("complementary", { name: "Workspace" }).getByRole("region", { name: "Spaces" });
  const twins = rows(spaces).filter({ hasText: "twin397" });
  await expect(twins).toHaveCount(2, { timeout: 20_000 });
  await expect(twins.filter({ hasText: "home" })).toHaveCount(1);
  await expect(twins.filter({ hasText: "data" })).toHaveCount(1);
  // This machine's row counts its terminals: one in each space, so 2, as many as the rows under it.
  await expect(spaces.getByLabel(/^\d+ terminals$/).first()).toHaveText("2");
  await twins.filter({ hasText: "data" }).click();
  await expect(twins.filter({ hasText: "data" })).toHaveAttribute("aria-current", /.+/);
  await expect(twins.filter({ hasText: "home" })).not.toHaveAttribute("aria-current", /.+/);
});
