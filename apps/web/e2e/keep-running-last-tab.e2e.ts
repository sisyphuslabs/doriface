import { expect, openNewTerminal, terminalCount, test } from "./fixtures.ts";

test.use({ serviceWorkers: "block" });

test("Keep running on the only tab's close takes the tab away, keeps its terminal, and stays so after a reload (#354)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  const address = (await terminal.getAttribute("data-terminal")) ?? "";
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(1);
  const running = (await terminalCount(page)).before;

  // Cmd+W on macOS; the pane close key elsewhere.
  await page.keyboard.press("Control+Shift+X");
  const ask = page.getByRole("dialog", { name: /^Close .+\?$/ });
  await ask.getByRole("button", { name: "Keep running" }).click();
  await expect(ask).toBeHidden();

  await expect(tabs).toHaveCount(0);
  await expect(page.locator(`[data-terminal="${address}"]`)).toHaveCount(0);
  await expect(page.getByRole("contentinfo")).toContainText(`${running} terminal`);

  await page.reload();
  await expect(page.getByRole("contentinfo")).toContainText(`${running} terminal`, { timeout: 20_000 });
  await expect(tabs).toHaveCount(0);
});
