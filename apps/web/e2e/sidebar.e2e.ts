import { expect, test } from "./fixtures.ts";
import { devices, type Locator, type Page } from "@playwright/test";
import { rowEdges, visibleCharacters } from "./sidebar-measure.ts";
import {
  KOREAN_SPACE,
  KOREAN_TITLE,
  LONG_MACHINE,
  machineConnected,
  renameMachine,
  SEEDS,
  SHARED_SPACE,
  start,
  stop,
} from "./sidebar-seed.ts";

/** What the macOS app sets beside its window buttons (apps/desktop TITLEBAR_INSET_START), and removes in full screen. */
const TITLEBAR_INSET_START = 78;
const MAC_INSET_CSS = `:root { --titlebar-inset-start: ${TITLEBAR_INSET_START}px; }`;

/** Hides the sidebar with its own button and returns the button that brings it back. */
async function hideSidebar(page: Page): Promise<Locator> {
  const sidebar = page.getByRole("complementary", { name: "Workspace" });
  await sidebar.getByRole("button", { name: "Hide sidebar" }).click();
  await expect(sidebar).toBeHidden();
  return page.getByRole("button", { name: "Show sidebar" });
}

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

let addresses: readonly string[] = [];
let restore = (): void => {};
test.beforeAll(async () => {
  restore = renameMachine();
  await machineConnected(LONG_MACHINE);
  addresses = SEEDS.map((seed) => start(seed, LONG_MACHINE));
});
test.afterAll(() => {
  try {
    stop(addresses);
  } finally {
    restore();
  }
});

test("a space named like one on another machine is selected, and opened, on its own machine only", async ({ page }) => {
  await page.goto("/");
  const spaces = page.getByRole("region", { name: "Spaces" });
  const shared = spaces.getByRole("button").filter({ hasText: SHARED_SPACE });
  await expect(shared).toHaveCount(2, { timeout: 20_000 });
  const here = shared.filter({ hasNotText: LONG_MACHINE });
  const there = shared.filter({ hasText: LONG_MACHINE });
  const focused = page.locator('[data-focused="true"] [data-terminal]');

  await here.click();
  await expect(focused).toHaveAttribute("data-terminal", /^t[0-9a-z]+$/, { timeout: 15_000 });
  await expect(here).toHaveAttribute("aria-current", "true");
  await expect(spaces.locator('[aria-current="true"]')).toHaveCount(1);

  await there.click();
  await expect(focused).toHaveAttribute("data-terminal", new RegExp(`^${LONG_MACHINE}/t[0-9a-z]+$`), {
    timeout: 15_000,
  });
  await expect(there).toHaveAttribute("aria-current", "true");
  await expect(spaces.locator('[aria-current="true"]')).toHaveCount(1);
});

/**
 * Every row of the Idle and Spaces lists stays inside its list, and every cut text keeps a share before its ellipsis:
 * the name five characters; when the row cannot hold five of each, the machine gives way to three first, then the
 * detail, then the name. `nameFive` says the list is wide enough for every name to keep five; `fiveEach` holds rows
 * whose texts and machine always fit five each.
 */
async function expectRowsKeepFloors(
  page: Page,
  nameFive: boolean,
  fiveEach: (narrow: boolean) => boolean,
): Promise<void> {
  const idle = page.getByRole("region", { name: "Idle" });
  const spaces = page.getByRole("region", { name: "Spaces" });
  const remote = idle.getByRole("button").filter({ hasText: "OmO - Verify bun" });
  const idleRows = await rowEdges(idle.getByRole("button"));
  const spaceRows = await rowEdges(spaces.getByRole("button"));
  for (const row of [...idleRows, ...spaceRows]) expect(row.overflow).toBeLessThanOrEqual(0.5);
  const ages = idleRows.map((row) => row.age ?? Number.NaN);
  expect(Math.max(...ages) - Math.min(...ages), "every age ends at the same edge").toBeLessThanOrEqual(0.5);

  const rows = [
    { row: remote, name: "OmO - Verify bun benchmarks on the box", detail: SHARED_SPACE, narrow: true },
    {
      row: idle.getByRole("button").filter({ hasText: "OmO - Draft the" }),
      name: "OmO - Draft the onboarding docs",
      detail: KOREAN_SPACE,
      narrow: false,
    },
    {
      row: idle.getByRole("button").filter({ hasText: KOREAN_TITLE.slice(0, 4) }),
      name: KOREAN_TITLE,
      detail: KOREAN_SPACE,
      narrow: false,
    },
  ];
  await Promise.all(
    rows.map(async ({ row, name: title, detail, narrow }) => {
      const kept = await Promise.all(
        [title, detail, LONG_MACHINE].map(async (text) => {
          const part = row.getByTitle(text, { exact: true });
          await expect(part, `a part of the row carries "${text}" as its title`).toHaveCount(1);
          await expect.soft(part).toHaveText(text);
          const { visible, total } = await visibleCharacters(part, text);
          return { text, visible, five: Math.min(5, total), three: Math.min(3, total) };
        }),
      );
      const [named, detailed, machine] = kept;
      for (const part of kept)
        expect(part.visible, `"${part.text}" keeps three characters`).toBeGreaterThanOrEqual(part.three);
      if (nameFive) expect(named?.visible, `"${title}" keeps five characters`).toBeGreaterThanOrEqual(named?.five ?? 5);
      if ((machine?.visible ?? 0) >= 5) {
        expect(detailed?.visible, `"${detail}" keeps as many as the machine`).toBeGreaterThanOrEqual(
          detailed?.five ?? 5,
        );
      }
      if (fiveEach(narrow)) {
        for (const part of kept)
          expect(part.visible, `"${part.text}" keeps five characters`).toBeGreaterThanOrEqual(part.five);
      }
    }),
  );

  const there = spaces.getByRole("button").filter({ hasText: SHARED_SPACE }).filter({ hasText: LONG_MACHINE });
  await expect(there.getByTitle(SHARED_SPACE, { exact: true })).toHaveText(SHARED_SPACE);
  await expect(there.getByTitle(LONG_MACHINE, { exact: true })).toHaveText(LONG_MACHINE);
}

/** Waits two frames, so a ResizeObserver has reported and any refit has been laid out. */
const settle = (page: Page) =>
  page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

const { defaultBrowserType: _browser, ...phone } = devices["iPhone 14"];
const VIEWPORTS = [
  { name: "1470x956@2", use: { viewport: { width: 1470, height: 956 }, deviceScaleFactor: 2 } },
  { name: "1280x800@1", use: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } },
  { name: "390", use: phone },
] as const;

for (const { name, use } of VIEWPORTS) {
  test.describe(`at ${name}`, () => {
    test.use(use);

    test("rows naming a long machine stay inside the list, every cut text keeps a share, an ellipsis and its tooltip, and they refit when the list narrows", async ({
      page,
    }) => {
      await page.goto("/");
      const remote = page
        .getByRole("region", { name: "Idle" })
        .getByRole("button")
        .filter({ hasText: "OmO - Verify bun" });
      await expect(remote).toBeVisible({ timeout: 20_000 });
      const phoneList = name === "390";
      // Two narrow texts and a narrow machine always fit five, and so does everything on a phone.
      await expectRowsKeepFloors(page, true, (narrow) => narrow || phoneList);
      const machines = page.getByRole("region", { name: "Machines" });
      await expect(machines.getByTitle(LONG_MACHINE, { exact: true })).toHaveText(LONG_MACHINE);

      // Narrower than where the floors were fitted, still wide enough for three of each: without a refit the parts keep
      // widths the row no longer holds and run past its edge.
      if (phoneList) await page.setViewportSize({ width: 320, height: 640 });
      else await page.evaluate(() => document.documentElement.style.setProperty("--sidebar-width", "15.5rem"));
      await settle(page);
      await expectRowsKeepFloors(page, phoneList, () => phoneList);
    });
  });
}

test("a hidden sidebar comes back from a named button at the window's left edge, by click, keyboard or shortcut", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "platform", { get: () => "Linux x86_64" });
    Object.defineProperty(Navigator.prototype, "userAgent", { get: () => "Mozilla/5.0 (X11; Linux x86_64)" });
  });
  await page.goto("/");
  const sidebar = page.getByRole("complementary", { name: "Workspace" });
  await sidebar.getByRole("region", { name: "Spaces" }).getByRole("button").first().click({ timeout: 20_000 });
  const show = await hideSidebar(page);
  const tablist = page.getByRole("tablist", { name: "Tabs" });
  const [button, tabs] = await Promise.all([show.boundingBox(), tablist.boundingBox()]);
  expect(button?.x).toBeLessThan(24);
  expect((button?.x ?? 0) + (button?.width ?? 0)).toBeLessThanOrEqual(tabs?.x ?? 0);

  await show.hover();
  await expect(page.locator("[data-side]").filter({ hasText: "Show sidebar" }).first()).toBeVisible();
  await tablist.getByRole("tab").first().focus();
  await page.keyboard.press("Shift+Tab");
  await expect(show).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(sidebar).toBeVisible();

  await page.keyboard.press("Control+Shift+B");
  await expect(sidebar).toBeHidden();
  await page.keyboard.press("Control+Shift+B");
  await expect(sidebar).toBeVisible();
});

test("with the macOS app's titlebar inset, the button that brings the sidebar back starts past the window buttons", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("complementary", { name: "Workspace" })).toBeVisible({ timeout: 20_000 });
  await page.addStyleTag({ content: MAC_INSET_CSS });
  const box = await (await hideSidebar(page)).boundingBox();
  expect(box?.x).toBe(TITLEBAR_INSET_START);
});
