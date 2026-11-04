import { devices, type Page } from "@playwright/test";
import { agentRow, endAgent, startShell } from "./agents.ts";
import { expect, laidOutBox, test } from "./fixtures.ts";
import { removeSpeech, stubSpeech } from "./speech-stub.ts";

const { defaultBrowserType: _browser, ...phone } = devices["iPhone 14"];
// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ ...phone, serviceWorkers: "block" });

const NAME = "dictate-fit";
const header = (page: Page) => page.getByRole("banner");

let address = "";
test.beforeEach(() => {
  address = startShell("host", NAME);
});
test.afterEach(() => {
  endAgent("host", address);
});

async function openShell(page: Page): Promise<void> {
  await page.goto("/");
  await agentRow(page, NAME, false).click();
  await expect(page.locator(`[data-terminal="${address}"]`)).toContainText("$", { timeout: 15_000 });
}

for (const width of [390, 320]) {
  test(`at ${width} px the header mic is a full touch target beside the session actions, and the title keeps its room`, async ({
    page,
  }) => {
    await stubSpeech(page);
    await page.setViewportSize({ width, height: 800 });
    await openShell(page);
    const bar = header(page);
    // One line at 390; at 320 the mic may push #207's second row to wrap, and the header grows instead of hiding it (#207).
    const held = await laidOutBox(bar);
    if (width === 390) expect(held.height).toBeCloseTo(48, 0);
    else expect(held.height).toBeGreaterThanOrEqual(48 - 0.5);
    // Its rows never spill; the header's own scrollHeight is not compared, as in #207's check: the buttons' 44 px hit
    // areas reach past it by design, and nothing there is cut.
    const spills = await bar.evaluate((el) =>
      [...el.querySelectorAll("h1, p, div")]
        .filter((node) => node.scrollHeight > node.clientHeight + 1)
        .map((node) => `${node.tagName.toLowerCase()} ${node.scrollHeight}>${node.clientHeight}`),
    );
    expect(spills).toEqual([]);
    const firstRow = await laidOutBox(page.locator("[data-terminal] .term-row").first());
    expect(firstRow.y).toBeGreaterThanOrEqual(held.y + held.height - 0.5);
    await expect(
      bar.locator("[data-header-action]").getByRole("button", { name: `Dictate into ${NAME}` }),
    ).toBeVisible();
    const mic = await bar.getByRole("button", { name: `Dictate into ${NAME}` }).boundingBox();
    const actions = await bar.getByRole("button", { name: /^Session actions for / }).boundingBox();
    for (const box of [mic, actions]) {
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    // In the header's row, before the actions menu, and inside the screen.
    expect((mic?.x ?? 0) + (mic?.width ?? 0)).toBeLessThanOrEqual((actions?.x ?? 0) + 0.5);
    expect((actions?.x ?? 0) + (actions?.width ?? 0)).toBeLessThanOrEqual(width + 0.5);
    expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    const title = await bar.getByRole("heading", { level: 1 }).boundingBox();
    expect(title?.width).toBeGreaterThan(40);
    // The key bar is untouched while nobody dictates: its keys keep their 44 pt.
    const key = await page.getByRole("button", { name: "Show keyboard" }).boundingBox();
    expect(key?.height).toBeGreaterThanOrEqual(44);
  });
}

test("where the browser has no speech recognition the mic says so, and why, and nothing listens", async ({ page }) => {
  await removeSpeech(page);
  await openShell(page);
  const mic = header(page).getByRole("button", { name: "Dictation unavailable" });
  await expect(mic).toBeVisible();
  await mic.click();
  const notice = page.getByRole("status").filter({ hasText: "Dictation isn't available here" });
  await expect(notice).toContainText("This browser has no speech recognition");
  await notice.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("button", { name: "Show keyboard" })).toBeVisible();
});
