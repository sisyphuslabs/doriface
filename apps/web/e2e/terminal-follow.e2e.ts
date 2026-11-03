import { expect, openNewTerminalBehindLatency, test } from "./fixtures.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

test("a terminal at the bottom keeps following output while the window resizes", async ({ page }) => {
  const { terminal } = await openNewTerminalBehindLatency(page, 300);
  await terminal.getByRole("textbox").focus();
  await page.keyboard.type("for i in $(seq 1 300); do printf 'line-%04d\\n' $i; sleep 0.02; done");
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText("line-0040", { timeout: 15_000 });
  const resizeThenSee = async (width: number, later: string): Promise<void> => {
    await page.setViewportSize({ width, height: 800 });
    const row = terminal.locator(".term-row").filter({ hasText: new RegExp(String.raw`^${later}\s*$`) });
    await expect(row).toBeInViewport({ timeout: 15_000 });
  };
  await resizeThenSee(820, "line-0080");
  await resizeThenSee(1280, "line-0120");
  await resizeThenSee(820, "line-0160");
  await resizeThenSee(1280, "line-0200");
});
