import { devices, type Page } from "@playwright/test";
import { endAgent, startAgent } from "./agents.ts";
import { expect, test } from "./fixtures.ts";

const { defaultBrowserType: _browser, ...phone } = devices["iPhone 14"];
// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ ...phone, serviceWorkers: "block" });

/** WCAG 2.2 SC 1.4.12 Text Spacing: the four overrides a user stylesheet may set, all at once. */
const TEXT_SPACING = `
  * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
  p { margin-bottom: 2em !important; }
`;

const header = (page: Page) => page.getByRole("banner");
const ACTION = "Header action";

/** Two-digit counts in every state, the widest the counts get in practice: 11 done, 11 working, 15 idle at least. */
const LARGE = { done: 11, working: 11, idle: 15 } as const;
const started: string[] = [];
test.beforeAll(() => {
  for (const [state, count] of Object.entries(LARGE)) {
    for (let index = 0; index < count; index += 1)
      started.push(startAgent("host", `wide-${state}-${index}`, state, "wide"));
  }
});
test.afterAll(() => {
  for (const address of started.splice(0)) endAgent("host", address);
});

async function openPhoneTerminal(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible({ timeout: 20_000 });
  await header(page).getByRole("button", { name: "New tab" }).click();
  await expect(page.locator("[data-terminal]")).toContainText("$", { timeout: 15_000 });
  await expect(header(page).getByRole("button", { name: "Back to agents" })).toBeVisible();
  await expect(header(page).locator("[data-agent-counts]")).toHaveText(/^\d{2,} done, \d{2,} working, \d{2,} idle$/, {
    timeout: 15_000,
  });
}

/** Fills the header's action slot with one more 44 px header button, as the mic (#227) does: a copy of the switch. */
async function giveAction(page: Page): Promise<void> {
  await header(page)
    .locator("[data-header-action]")
    .evaluate((slot, name) => {
      const model = slot.closest("header")?.querySelector('button[aria-label="Switch space or tab"]');
      const action = model?.cloneNode(true);
      if (!(action instanceof HTMLElement)) throw new Error("no header button to copy");
      action.setAttribute("aria-label", name);
      slot.append(action);
    }, ACTION);
  await expect(header(page).getByRole("button", { name: ACTION })).toBeVisible();
}

/** The header holds its content and grows for it: at least 48 px, nothing cut, nothing over the terminal. */
async function expectHeaderHolds(page: Page, width: number, withAction: boolean): Promise<void> {
  const bar = header(page);
  await expect(bar.getByRole("heading", { level: 1 })).toBeVisible();
  const box = await bar.boundingBox();
  const bottom = (box?.y ?? 0) + (box?.height ?? 0);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(48 - 0.5);

  // Every item of the header ends inside it, and none of its rows spills out of its own box vertically. (The header's
  // own scrollHeight is not compared: the buttons' larger hit areas reach past it by design, and nothing there is cut.)
  const spills = await bar.evaluate((el) => {
    const edge = el.getBoundingClientRect();
    const outside = [...el.children]
      .filter((child) => {
        const rect = child.getBoundingClientRect();
        return rect.height > 0 && (rect.top < edge.top - 0.5 || rect.bottom > edge.bottom + 0.5);
      })
      .map((child) => `${child.tagName.toLowerCase()} outside the header`);
    const spilled = [...el.querySelectorAll("h1, p, div")]
      .filter((node) => node.scrollHeight > node.clientHeight + 1)
      .map((node) => `${node.tagName.toLowerCase()} ${node.scrollHeight}>${node.clientHeight}`);
    return [...outside, ...spilled];
  });
  expect(spills).toEqual([]);

  // Every text row, the tab position and the counts end inside the header and the screen; the last two are never cut.
  const parts = [
    bar.getByRole("heading", { level: 1 }),
    bar.locator("p"),
    bar.locator("[data-tab-position]"),
    bar.locator("[data-agent-counts]"),
  ];
  const placed = await Promise.all(
    parts.map((part) =>
      part.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return { bottom: rect.bottom, right: rect.right, cut: el.scrollWidth > el.clientWidth + 1 };
      }),
    ),
  );
  for (const part of placed) {
    expect(part.bottom).toBeLessThanOrEqual(bottom + 0.5);
    expect(part.right).toBeLessThanOrEqual(width + 0.5);
  }
  expect(placed.slice(2).map((part) => part.cut)).toEqual([false, false]);

  // The terminal begins below the header, never under it.
  const terminal = await page.locator("[data-terminal]").boundingBox();
  expect(terminal?.y ?? 0).toBeGreaterThanOrEqual(bottom - 0.5);
  const firstRow = await page.locator("[data-terminal] .term-row").first().boundingBox();
  expect(firstRow?.y ?? 0).toBeGreaterThanOrEqual(bottom - 0.5);

  // Every button stays a full touch target inside the header and the screen.
  const names = [/^Back to agents$/, /^Switch space or tab$/, /^Session actions for /];
  if (withAction) names.push(new RegExp(`^${ACTION}$`));
  const targets = await Promise.all(names.map((name) => bar.getByRole("button", { name }).boundingBox()));
  for (const target of targets) {
    expect(target?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(target?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect((target?.x ?? 0) + (target?.width ?? 0)).toBeLessThanOrEqual(width + 0.5);
    expect((target?.y ?? 0) + (target?.height ?? 0)).toBeLessThanOrEqual(bottom + 0.5);
  }
}

for (const width of [390, 320]) {
  for (const withAction of [false, true]) {
    test(`at ${width} px${withAction ? " with a header action" : ""} the terminal header grows to hold its rows, with and without 1.4.12 text spacing`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await openPhoneTerminal(page);
      if (withAction) await giveAction(page);
      await expectHeaderHolds(page, width, withAction);
      await page.addStyleTag({ content: TEXT_SPACING });
      await expectHeaderHolds(page, width, withAction);
    });
  }
}
