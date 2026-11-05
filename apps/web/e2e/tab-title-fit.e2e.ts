// #478: a machine terminal's tab gives its width to the terminal's title. Tabs belong to a space and a space is one
// machine's (#404), so the tab carries no machine label for the title to lose to.
import { endAgent, startAgent } from "./agents.ts";
import { expect, test } from "./fixtures.ts";
import { MACHINE_NAME } from "./machine.ts";

test.use({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });

const TITLE = "remote-build-pipeline-watcher";

test("the active tab of a machine's terminal shows its title, and no machine label takes its width", async ({
  page,
}) => {
  const address = startAgent("machine", TITLE, "idle");
  try {
    await page.goto("/");
    const tab = page.getByRole("tablist", { name: "Tabs" }).getByRole("tab", { name: new RegExp(TITLE) });
    await tab.click({ timeout: 20_000 });
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(tab).not.toContainText(MACHINE_NAME);
    // The title is shown whole: no part of the tab's text is cut with an ellipsis.
    const cut = await tab.evaluate((el) =>
      [...el.querySelectorAll("*")].some(
        (node) =>
          node instanceof HTMLElement && node.textContent === node.innerText && node.scrollWidth > node.clientWidth,
      ),
    );
    expect(cut).toBe(false);
    await expect(tab).toContainText(TITLE);
  } finally {
    endAgent("machine", address);
  }
});
