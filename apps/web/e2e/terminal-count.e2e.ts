import { expect, openNewTerminal, test } from "./fixtures.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

test("the status bar shows no terminal count until the host has listed its terminals", async ({ page }) => {
  await page.goto("/");
  await openNewTerminal(page);
  // Every count the status bar ever renders, from the first paint of the reloaded page on.
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.assign(window, { terminalCounts: seen });
    new MutationObserver(() => {
      const count = document.querySelector('[role="contentinfo"], footer')?.textContent?.match(/\d+ terminals?/)?.[0];
      if (count !== undefined && seen.at(-1) !== count) seen.push(count);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await page.reload();
  const count = page.getByRole("contentinfo").getByText(/^\d+ terminals?\b/);
  await expect(count).toBeVisible({ timeout: 20_000 });
  const seen = await page.evaluate(() => Reflect.get(window, "terminalCounts"));
  expect(seen).not.toContain("0 terminals");
});
