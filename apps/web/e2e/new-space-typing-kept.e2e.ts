// #381: a new terminal on an added machine is listed, and shown alone in no document's tab, before its run answers;
// the tab the answer writes must take over the same view, or the keys typed into it while it swaps are lost.
import { LAYOUT_DOC } from "@doriface/protocol/layout";
import { getCoreDoc, setCoreDoc } from "./core-doc.ts";
import { expect, test } from "./fixtures.ts";
import { routeHcSocket } from "./hc-socket.ts";
import { MACHINE_NAME } from "./machine.ts";
import { hcOn, machineRow, newOn } from "./machine-switch.ts";

test.use({ serviceWorkers: "block" });

/** The answer to terminal.run: the started terminal, address first. */
const RUN_ANSWER = '"result":{"address"';

test("typing into a new terminal on an added machine while its tab is being written loses no key", async ({ page }) => {
  // Only a screen whose layouts hold no tab shows a listed terminal alone, as on a first start.
  const kept = { here: getCoreDoc(LAYOUT_DOC), there: getCoreDoc(LAYOUT_DOC, MACHINE_NAME) };
  setCoreDoc(LAYOUT_DOC, null);
  setCoreDoc(LAYOUT_DOC, null, MACHINE_NAME);
  const link = await routeHcSocket(page);
  let address = "";
  try {
    await page.goto("/");
    await expect(machineRow(page)).toContainText("connected", { timeout: 20_000 });
    const releaseAnswer = link.holdFromHost(RUN_ANSWER);
    await newOn(page).click({ force: true });
    const alone = page.locator('[data-tab-id="transient"]');
    const terminal = page.locator(`[data-terminal^="${MACHINE_NAME}/"]`);
    await expect(terminal).toContainText("$", { timeout: 15_000 });
    await expect(alone).toHaveCount(1);
    address = (await terminal.getAttribute("data-terminal")) ?? "";
    await terminal.evaluate((view) => view.setAttribute("data-before-answer", ""));
    await terminal.click();
    await page.keyboard.type("echo kept-");

    releaseAnswer();
    await expect(alone).toHaveCount(0, { timeout: 15_000 });
    await page.keyboard.type("whole");
    await page.keyboard.press("Enter");

    await expect(terminal).toContainText("kept-whole", { timeout: 15_000 });
    await expect(page.locator(`[data-terminal="${address}"][data-before-answer]`)).toHaveCount(1);
  } finally {
    const local = address.slice(MACHINE_NAME.length + 1);
    if (local !== "") {
      hcOn("machine", ["kill", local]);
      hcOn("machine", ["rm", local]);
    }
    setCoreDoc(LAYOUT_DOC, kept.here);
    setCoreDoc(LAYOUT_DOC, kept.there, MACHINE_NAME);
  }
});
