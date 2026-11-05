import { startShell } from "./agents.ts";
import { expect, test } from "./fixtures.ts";
import { seedLayout } from "./layout-doc.ts";
import { hcOn } from "./machine-switch.ts";

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const shells: string[] = [];
test.afterEach(() => {
  for (const address of shells.splice(0)) hcOn("host", ["kill", address]);
});

test("on a phone a split tab shows one pane at a time, and the pane switcher moves between them", async ({ page }) => {
  const [left, right] = [startShell("host", "phone-left"), startShell("host", "phone-right")];
  shells.push(left, right);
  seedLayout([
    {
      id: "tb-phone",
      root: [
        { pane: "pl", terminal: left, weight: 0.5 },
        { pane: "pr", terminal: right, weight: 0.5 },
      ],
    },
  ]);
  await page.goto("/");
  await page
    .getByRole("button", { name: /phone-left/ })
    .first()
    .click();
  const shown = page.locator("[data-terminal]:visible");
  await expect(shown).toHaveCount(1, { timeout: 20_000 });
  await expect(shown).toHaveAttribute("data-terminal", left);

  const panes = page.getByRole("navigation", { name: "Panes in this tab" });
  await expect(panes.getByText("Pane 1 of 2")).toBeVisible();
  await panes.getByRole("button", { name: "Next pane" }).click();
  await expect(shown).toHaveAttribute("data-terminal", right, { timeout: 15_000 });
  await expect(panes.getByText("Pane 2 of 2")).toBeVisible();
  await expect(shown).toContainText("$", { timeout: 15_000 });
  await panes.getByRole("button", { name: "Previous pane" }).click();
  await expect(shown).toHaveAttribute("data-terminal", left, { timeout: 15_000 });
});
