// #478 and the #466 ruling (herdr-app's tabs mod): a tab reads its name, else its number, with its program's icon. A
// machine terminal's tab carries no machine label (tabs belong to a space and a space is one machine's, #404), does not
// take the terminal's title, and has no tooltip.
import { agentRow, endAgent, startAgent } from "./agents.ts";
import { expect, test } from "./fixtures.ts";
import { MACHINE_NAME } from "./machine.ts";
import { tabOf } from "./tab-strip.ts";

test.use({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });

const TITLE = "remote-build-pipeline-watcher";

test("the active tab of a machine's agent reads its number with the agent's icon: no title, machine label or tooltip", async ({
  page,
}) => {
  const address = startAgent("machine", TITLE, "idle");
  try {
    await page.goto("/");
    await agentRow(page, TITLE, true).click({ timeout: 20_000 });
    const tab = await tabOf(page, `${MACHINE_NAME}/${address}`);
    await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 15_000 });
    await expect(tab).toHaveText(/^\d+$/);
    await expect(tab).not.toContainText(TITLE);
    await expect(tab).not.toContainText(MACHINE_NAME);
    await expect(tab).not.toHaveAttribute("title");
    await expect(tab.locator("[title]")).toHaveCount(0);
    await expect(tab.locator("svg.lucide-bot")).toHaveCount(1);
  } finally {
    endAgent("machine", address);
  }
});
