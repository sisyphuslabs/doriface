import type { Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { E2E_HOST_ENV } from "./config.ts";
import { expect, openNewTerminal, test } from "./fixtures.ts";
import { type HcSocket, routeHcSocket } from "./hc-socket.ts";
import { readSavedEnv } from "./saved-env.ts";

test.use({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });

const focused = (page: Page) => page.locator('[data-focused="true"] [data-terminal]');
const mac = (page: Page) => page.evaluate(() => /mac/i.test(navigator.platform));
const catcher = (page: Page) => page.locator("[data-type-ahead]");

/** What the terminal's screen holds on the core itself, so nothing on the page can stand in for it. */
function screenOnCore(address: string): string[] {
  const { hc, env } = readSavedEnv(E2E_HOST_ENV);
  return execFileSync(hc, ["read", address], { env: { ...process.env, ...env }, encoding: "utf8" })
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== "");
}

const runsSent = (link: HcSocket): number =>
  link.sent().filter((frame) => frame.includes('"method":"terminal.run"')).length;

const LINE = "echo ahead-$((40+2))";

type Via = "keys" | "button" | "palette";

/** Asks for a new tab the way a person would, from the previous terminal. */
async function askNewTab(page: Page, previous: ReturnType<Page["locator"]>, via: Via): Promise<void> {
  if (via === "button") return void (await page.getByRole("button", { name: "New tab" }).first().click());
  await previous.getByRole("textbox").focus();
  const onMac = await mac(page);
  if (via === "keys") return void (await page.keyboard.press(onMac ? "Meta+KeyT" : "Control+Shift+KeyT"));
  await page.keyboard.press(onMac ? "Meta+Shift+KeyP" : "Control+Shift+KeyP");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("New tab");
  await page.keyboard.press("Enter");
}

for (const via of ["keys", "button", "palette"] as const) {
  test(`typing straight after a new tab (${via}) reaches the new terminal in full, and the previous one gets nothing`, async ({
    page,
  }) => {
    const link = await routeHcSocket(page);
    await page.goto("/");
    const previous = await openNewTerminal(page);
    const address = await previous.getAttribute("data-terminal");
    if (address === null) throw new Error("the previous terminal has no address");

    // The new terminal is held back: its terminal.run waits, so every key is typed before it can exist.
    const before = runsSent(link);
    const release = link.hold("terminal.run");
    await askNewTab(page, previous, via);
    await page.keyboard.type(LINE, { delay: 40 });
    await page.keyboard.press("Enter");
    // One new tab was asked for: the space and Enter typed meanwhile must not press New tab again.
    expect(runsSent(link) - before).toBe(1);
    release();

    await expect
      .poll(async () => await focused(page).getAttribute("data-terminal"), { timeout: 15_000 })
      .not.toBe(address);
    const fresh = focused(page);
    await expect(fresh).toContainText("ahead-42", { timeout: 15_000 });
    await expect(fresh).toContainText(LINE);
    expect(screenOnCore(address)).toEqual(["$"]);
    await expect(catcher(page)).toHaveAttribute("inert", "");
  });
}

test("while no terminal is being started the holding input is out of the page: not announced, not focusable", async ({
  page,
}) => {
  await page.goto("/");
  await openNewTerminal(page);
  await expect(catcher(page)).toHaveAttribute("inert", "");
  await expect(catcher(page)).toHaveAttribute("aria-hidden", "true");
  await expect(page.getByRole("textbox", { name: /New terminal starting/ })).toHaveCount(0);
  const took = await catcher(page).evaluate((element: HTMLTextAreaElement) => {
    element.focus();
    return document.activeElement === element;
  });
  expect(took).toBe(false);
});

test("input typed for a terminal that fails to start is reported as not sent, and reaches no other terminal", async ({
  page,
}) => {
  const link = await routeHcSocket(page);
  await page.goto("/");
  const previous = await openNewTerminal(page);
  const address = await previous.getAttribute("data-terminal");
  if (address === null) throw new Error("the previous terminal has no address");
  link.hold("terminal.run");
  await askNewTab(page, previous, "keys");
  await page.keyboard.type(LINE, { delay: 40 });
  // The line drops while terminal.run is unanswered, so the run fails.
  await link.drop(true);
  await expect(page.getByText("What you typed was not sent")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/did not start/)).toBeVisible();
  link.restore();
  expect(screenOnCore(address)).toEqual(["$"]);
});

test("input typed for a terminal whose view does not open in time is reported as not sent", async ({ page }) => {
  const link = await routeHcSocket(page);
  await page.clock.install();
  await page.goto("/");
  const previous = await openNewTerminal(page);
  const address = await previous.getAttribute("data-terminal");
  if (address === null) throw new Error("the previous terminal has no address");
  const answered = (): number => link.received().filter((frame) => /"result":\{[^}]*"address"/.test(frame)).length;
  const answersBefore = answered();
  // The feed is held, so the new terminal is never listed and its view cannot mount.
  const releaseFeed = link.holdFromHost('"method":"event"', '"method":"heartbeat"', '"method":"missed"');
  await askNewTab(page, previous, "keys");
  await page.keyboard.type(LINE, { delay: 40 });
  await expect.poll(answered, { timeout: 15_000 }).toBeGreaterThan(answersBefore);
  await page.clock.runFor(16_000);
  await expect(page.getByText("What you typed was not sent")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/took too long/)).toBeVisible();
  releaseFeed();
  expect(screenOnCore(address)).toEqual(["$"]);
});
