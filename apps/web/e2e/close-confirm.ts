import type { Locator, Page } from "@playwright/test";
import { expect } from "./fixtures.ts";

/** Sets the terminal config's confirm-close-surface in Settings, then comes back to the workspace. */
export async function setConfirmClose(page: Page, value: "true" | "false" | "always"): Promise<void> {
  await page.goto("/settings");
  await page
    .getByRole("tab", { name: "Terminal" })
    .or(page.getByRole("button", { name: "Terminal" }))
    .first()
    .click();
  const choice = page.getByRole("group", { name: "confirm-close-surface" }).getByRole("button", { name: value });
  await choice.click();
  await expect(choice).toHaveAttribute("aria-pressed", "true");
  await page.goto("/");
}

/** Starts `sleep 600` in front of the shell and waits until its session is named for it, so the screen knows it runs. */
export async function runSleep(page: Page, terminal: Locator): Promise<void> {
  await terminal.getByRole("textbox").focus();
  await page.keyboard.type("sleep 600");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^Session actions for sleep/ })).toBeVisible({ timeout: 15_000 });
}
