import type { Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { E2E_HOST_ENV } from "./config.ts";
import { expect, openNewTerminal, test } from "./fixtures.ts";
import { routeHcSocket } from "./hc-socket.ts";
import { readSavedEnv } from "./saved-env.ts";

test.use({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });

const focused = (page: Page) => page.locator('[data-focused="true"] [data-terminal]');

/** What the terminal's screen holds on the core itself, so nothing on the page can stand in for it. */
function screenOnCore(address: string): string {
  const { hc, env } = readSavedEnv(E2E_HOST_ENV);
  return execFileSync(hc, ["read", address], { env: { ...process.env, ...env }, encoding: "utf8" });
}

const LINE = "echo ahead-$((40+2))";

for (const via of ["keys", "button"] as const) {
  test(`typing straight after a new tab (${via}) reaches the new terminal in full, and the previous one gets nothing`, async ({
    page,
  }) => {
    const link = await routeHcSocket(page);
    await page.goto("/");
    const previous = await openNewTerminal(page);
    const address = await previous.getAttribute("data-terminal");
    if (address === null) throw new Error("the previous terminal has no address");

    // The new terminal is held back: its terminal.run waits, so every key is typed before it can exist.
    const runs = (): number => link.sent().filter((frame) => frame.includes('"method":"terminal.run"')).length;
    const runsBefore = runs();
    const release = link.hold("terminal.run");
    if (via === "keys") {
      await previous.getByRole("textbox").focus();
      const mac = await page.evaluate(() => /mac/i.test(navigator.platform));
      await page.keyboard.press(mac ? "Meta+KeyT" : "Control+Shift+KeyT");
    } else {
      await page.getByRole("button", { name: "New tab" }).first().click();
    }
    await page.keyboard.type(LINE, { delay: 40 });
    await page.keyboard.press("Enter");
    // One new tab was asked for: the space and Enter typed meanwhile must not press New tab again.
    expect(runs() - runsBefore).toBe(1);
    release();

    await expect
      .poll(async () => await focused(page).getAttribute("data-terminal"), { timeout: 15_000 })
      .not.toBe(address);
    const fresh = focused(page);
    await expect(fresh).toContainText("ahead-42", { timeout: 15_000 });
    await expect(fresh).toContainText(LINE);
    const kept = screenOnCore(address)
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line !== "");
    expect(kept).toEqual(["$"]);
  });
}
