import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { type FakeRelayHost, startFakeRelayHost } from "./relay-route.ts";

const OUT = join(import.meta.dirname, "../../../docs/design/app");

async function workspace(browser: Browser, host: FakeRelayHost): Promise<Page> {
  const context = await browser.newContext({ colorScheme: "light" });
  const page = await context.newPage();
  await page.setViewportSize({ width: 768, height: 1024 });
  await host.route(page);
  return page;
}

// Capture only: it writes a tracked image and shows the checkout's own git state, which a CI run would churn.
test.skip(process.env["CAPTURE"] !== "1", "CAPTURE=1 runs the capture");

test("the joined workspace at 768, settled and neutral", async ({ browser }) => {
  test.setTimeout(240_000);
  // A plain directory, so the space's row carries no branch name and no ahead/behind counts.
  const project = join(mkdtempSync(join(tmpdir(), "capture-")), "project");
  mkdirSync(project);
  const host = await startFakeRelayHost({ machine: true, terminal: true, cwd: project });
  try {
    const link = await host.pairingLink();
    const page = await workspace(browser, host);
    await page.goto(link);
    await page.getByRole("button", { name: "They match" }).click({ timeout: 60_000 });
    await page.getByRole("link", { name: "Open terminals" }).click({ timeout: 90_000 });
    const terminal = page.locator("[data-terminal]");
    await expect(terminal).toContainText("$", { timeout: 90_000 });
    const aside = page.locator("aside").first();
    await expect(aside).toContainText("studio", { timeout: 30_000 });
    // The row also shows the checkout's branch and its ahead/behind counts; neither belongs in a docs image.
    await expect(aside).not.toContainText(/[↑↓]/);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0, { timeout: 15_000 });
    const skip = page.getByRole("button", { name: "Skip" });
    if (await skip.isVisible()) {
      await skip.click();
      await expect(page.getByText("Getting started")).toHaveCount(0, { timeout: 15_000 });
    }
    await terminal.click();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(OUT, "join-768-workspace-day.png"), animations: "disabled" });
  } finally {
    await host.stop();
  }
});
