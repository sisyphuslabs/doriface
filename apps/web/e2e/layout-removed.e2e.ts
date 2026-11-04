import { startShell } from "./agents.ts";
import { getCoreDoc } from "./core-doc.ts";
import { expect, test } from "./fixtures.ts";
import { clearLayout, LAYOUT_DOC, paneOf, seedLayout } from "./layout-doc.ts";
import { hcOn } from "./machine-switch.ts";

test.use({ serviceWorkers: "block" });

const shells: string[] = [];
const shell = (name: string): string => {
  const address = startShell("host", `removed-${name}`);
  shells.push(address);
  return address;
};

test.afterEach(() => {
  clearLayout();
  for (const address of shells.splice(0)) hcOn("host", ["kill", address]);
});

const inSavedLayout = (address: string): boolean =>
  JSON.stringify(getCoreDoc(LAYOUT_DOC)).includes(`"terminal":"${address}"`);

test("a terminal removed while no page was open leaves the shared layout once a page opens", async ({ page }) => {
  const [kept, gone, splitKept, splitGone] = [shell("kept"), shell("gone"), shell("split-kept"), shell("split-gone")];
  seedLayout([
    { id: "tb-kept", root: [{ pane: "p1", terminal: kept }] },
    { id: "tb-gone", root: [{ pane: "p2", terminal: gone }] },
    {
      id: "tb-split",
      root: [
        { pane: "p3", terminal: splitKept, weight: 0.5 },
        { pane: "p4", terminal: splitGone, weight: 0.5 },
      ],
    },
  ]);
  // No page is open: the core removes two of the terminals, as `hc kill` and `hc rm` do.
  for (const address of [gone, splitGone]) {
    hcOn("host", ["kill", address]);
    hcOn("host", ["rm", address]);
    shells.splice(shells.indexOf(address), 1);
  }

  await page.goto("/");
  const strip = page.getByRole("tablist", { name: "Tabs" }).getByRole("tab");
  await expect(strip).toHaveCount(2, { timeout: 20_000 });
  await expect.poll(() => [gone, splitGone].filter(inSavedLayout), { timeout: 15_000 }).toEqual([]);
  expect([kept, splitKept].filter(inSavedLayout)).toEqual([kept, splitKept]);
  await expect(page.getByText("Waiting for this terminal to start")).toHaveCount(0);
  await strip.nth(1).click();
  await expect(paneOf(page, splitKept)).toContainText("$", { timeout: 15_000 });
});
