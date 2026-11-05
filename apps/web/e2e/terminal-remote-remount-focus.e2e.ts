import { expect, openNewTerminal, test } from "./fixtures.ts";
import { clearLayouts } from "./layout-doc.ts";

test.use({ serviceWorkers: "block" });

test.afterEach(() => clearLayouts());

// Another device rewriting the shared layout moves this page's terminal into another tab, which mounts its view again
// (#332). That view starts and attaches with nobody here asking for it, so it leaves the keyboard where the user put it.
test("a terminal another device's layout edit mounts again leaves the keyboard where it was", async ({ page }) => {
  await page.goto("/");
  await openNewTerminal(page);
  const palette = page.getByRole("button", { name: "Command palette" });
  await palette.focus();
  const terminal = page.locator('[data-focused="true"] [data-terminal]');
  const before = await terminal.getAttribute("data-ready");
  expect(before).toBe("true");
  clearLayouts();
  // The rewrite lands, the tab becomes this screen's own, and its terminal mounts and attaches again.
  await expect(page.locator('[data-focused="true"] [data-terminal][data-ready="true"]')).toBeVisible();
  await expect(page.locator('[data-focused="true"] [data-terminal]')).toContainText("$");
  await expect(palette).toBeFocused();
});

test("a terminal this page opens still takes the keyboard", async ({ page }) => {
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  await expect(terminal.locator("textarea")).toBeFocused();
});
