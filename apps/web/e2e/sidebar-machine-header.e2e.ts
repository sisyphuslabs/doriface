import type { Page } from "@playwright/test";
import { endAgent, startAgent } from "./agents.ts";
import { expect, test } from "./fixtures.ts";
import { seedSpaces } from "./layout-doc.ts";
import { MACHINE_NAME } from "./machine.ts";
import { rows } from "./sidebar-measure.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });

const spaces = (page: Page) =>
  page.getByRole("complementary", { name: "Workspace" }).getByRole("region", { name: "Spaces", exact: true });
/** This machine's group comes first; an added machine's is named after it. */
const group = (page: Page, name?: string) =>
  name === undefined
    ? spaces(page).getByRole("region").first()
    : spaces(page).getByRole("region", { name, exact: true });

let address = "";
test.beforeAll(() => {
  address = startAgent("host", "mh-fold", "idle", "mhfold");
});
test.afterAll(() => endAgent("host", address));

test("each machine header carries New space, a status dot and a fold chevron that hides its spaces across a reload", async ({
  page,
}) => {
  // The sidebar lists the layout's spaces (#404): one named mhfold, showing the agent.
  seedSpaces([
    { id: "spc-mhfold", name: "mhfold", folder: "", tabs: [{ id: "tb-mhfold", name: "", terminal: address }] },
  ]);
  await page.goto("/");
  const studio = group(page);
  await expect(rows(spaces(page)).filter({ hasText: "mhfold" })).toBeVisible({ timeout: 20_000 });
  await expect(studio.getByRole("button", { name: /^New space on / })).toBeVisible();
  await expect(studio.locator("[data-machine-dot]")).toHaveAttribute("data-machine-dot", "online");
  const fold = studio.getByRole("button", { name: /^Collapse / });
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await fold.click();
  await expect(rows(spaces(page)).filter({ hasText: "mhfold" })).toHaveCount(0);
  await page.reload();
  await expect(group(page).getByRole("button", { name: /^Expand / })).toHaveAttribute("aria-expanded", "false", {
    timeout: 20_000,
  });
  await expect(rows(spaces(page)).filter({ hasText: "mhfold" })).toHaveCount(0);
  await group(page)
    .getByRole("button", { name: /^Expand / })
    .click();
  await expect(rows(spaces(page)).filter({ hasText: "mhfold" })).toBeVisible();
});

test("a machine with no spaces offers New space there under its header", async ({ page }) => {
  await page.goto("/");
  const remote = group(page, MACHINE_NAME);
  await expect(remote.getByRole("button", { name: "New space there" })).toBeVisible({ timeout: 20_000 });
});
