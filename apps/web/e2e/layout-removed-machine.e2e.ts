import { startShell } from "./agents.ts";
import { getCoreDoc } from "./core-doc.ts";
import { expect, test } from "./fixtures.ts";
import { clearLayouts, LAYOUT_DOC, paneOf, seedLayout } from "./layout-doc.ts";
import { MACHINE_NAME } from "./machine.ts";
import { hcOn, machineRow, STATE_BOUND_MS } from "./machine-switch.ts";
import { rows } from "./sidebar-measure.ts";

test.use({ serviceWorkers: "block" });

const shells: string[] = [];
const shell = (name: string): string => {
  const address = startShell("machine", `removed-${name}`);
  shells.push(address);
  return address;
};

test.afterEach(() => {
  clearLayouts();
  for (const address of shells.splice(0)) hcOn("machine", ["kill", address]);
});

/** Whether the added machine's own layout document still names that terminal (its local address, as herdr-app saves it). */
const inMachineLayout = (local: string): boolean =>
  JSON.stringify(getCoreDoc(LAYOUT_DOC, MACHINE_NAME)).includes(`"terminal":"${local}"`);

test("a terminal removed on an added machine while no page was open leaves its layout once a page opens", async ({
  page,
}) => {
  const [kept, gone, splitKept, splitGone] = [shell("kept"), shell("gone"), shell("split-kept"), shell("split-gone")];
  seedLayout(
    [
      { id: "tb-kept", root: [{ pane: "p1", terminal: kept }] },
      { id: "tb-gone", root: [{ pane: "p2", terminal: gone }] },
      {
        id: "tb-split",
        root: [
          { pane: "p3", terminal: splitKept, weight: 0.5 },
          { pane: "p4", terminal: splitGone, weight: 0.5 },
        ],
      },
    ],
    "/tmp",
    MACHINE_NAME,
  );
  // No page is open: the machine's own core removes two of its terminals, as `hc kill` and `hc rm` there do.
  for (const address of [gone, splitGone]) {
    hcOn("machine", ["kill", address]);
    hcOn("machine", ["rm", address]);
    shells.splice(shells.indexOf(address), 1);
  }

  await page.goto("/");
  await expect(machineRow(page)).toContainText("connected", { timeout: 20_000 });
  await expect.poll(() => [gone, splitGone].filter(inMachineLayout), { timeout: STATE_BOUND_MS }).toEqual([]);
  expect([kept, splitKept].filter(inMachineLayout)).toEqual([kept, splitKept]);
  // The strip shows the selected space's tabs (#404): the seeded space, named after its folder, under the machine.
  const group = page.getByRole("region", { name: "Spaces" }).getByRole("region", { name: MACHINE_NAME, exact: true });
  await rows(group).filter({ hasText: "tmp" }).click();
  const strip = page.getByRole("tablist", { name: "Tabs" }).getByRole("tab");
  await expect(strip).toHaveCount(2);
  await expect(page.getByText("Waiting for this terminal to start")).toHaveCount(0);
  // The machine's tabs follow its document's order: the kept tab, then the split.
  await strip.nth(1).click();
  await expect(paneOf(page, `${MACHINE_NAME}/${splitKept}`)).toContainText("$", { timeout: 15_000 });
});
