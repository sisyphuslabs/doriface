import { startShell } from "./agents.ts";
import { expect, test } from "./fixtures.ts";
import { routeHcSocket } from "./hc-socket.ts";
import { clearLayout, paneOf, seedLayout, type SeedTab } from "./layout-doc.ts";
import { hcOn } from "./machine-switch.ts";

test.use({ serviceWorkers: "block" });

const shells: string[] = [];

test.afterEach(() => {
  clearLayout();
  for (const address of shells.splice(0)) hcOn("host", ["kill", address]);
});

/** LayoutDoc's CONFLICT_RETRIES: the compare-and-sets one edit makes before it gives up. */
const ATTEMPTS = 8;

test("a split whose write another device beats on every retry keeps its new terminal on this screen and says why", async ({
  page,
}) => {
  const one = startShell("host", "busy-one");
  shells.push(one);
  const tab: SeedTab = { id: "tb-busy", root: [{ pane: "p1", terminal: one }] };
  seedLayout([tab]);
  const socket = await routeHcSocket(page);
  await page.goto("/");
  await expect(paneOf(page, one)).toContainText("$", { timeout: 20_000 });

  const writes = (): number => socket.sent().filter((frame) => frame.includes('"method":"doc.set"')).length;
  let release = socket.hold("doc.set");
  /** Another device writes the layout between the split's read and its compare-and-set number `attempt`. */
  const beat = async (attempt: number): Promise<void> => {
    await expect.poll(writes, { timeout: 15_000 }).toBe(attempt);
    seedLayout([tab]);
    release();
    release = socket.hold("doc.set");
  };
  await page.getByRole("button", { name: "Split right" }).click();
  await Array.from({ length: ATTEMPTS }, (_unused, index) => index + 1).reduce<Promise<void>>(
    (previous, attempt) => previous.then(() => beat(attempt)),
    Promise.resolve(),
  );
  release();

  await expect(page.getByText("The layout was not saved")).toBeVisible({ timeout: 15_000 });
  // The new terminal is kept in a tab of this screen's own, a space of no document, so the strip shows it alone (#404).
  const strip = page.getByRole("tablist", { name: "Tabs" }).getByRole("tab");
  await expect(strip).toHaveCount(1);
  const shown = page.locator("[data-terminal]:visible");
  await expect(shown).toHaveCount(1);
  const made = (await shown.getAttribute("data-terminal")) ?? "";
  shells.push(made);
  expect(made).not.toBe(one);
  await expect(shown).toContainText("$", { timeout: 15_000 });
  // The saved tab is still there, in its space.
  await page
    .getByRole("complementary", { name: "Workspace" })
    .getByRole("region", { name: "Spaces" })
    .getByRole("button", { name: /^tmp\b/ })
    .click();
  await expect(strip).toHaveCount(1);
  await expect(paneOf(page, one)).toBeVisible();
});
