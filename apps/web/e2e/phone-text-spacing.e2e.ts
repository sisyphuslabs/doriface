import { devices, type Page } from "@playwright/test";
import { expect, laidOutBox, test } from "./fixtures.ts";

const { defaultBrowserType: _browser, ...phone } = devices["iPhone 14"];
// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ ...phone, serviceWorkers: "block" });

/** WCAG 2.2 SC 1.4.12 Text Spacing: the four overrides a user stylesheet may set, all at once. */
const TEXT_SPACING = `
  * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
  p { margin-bottom: 2em !important; }
`;

const header = (page: Page) => page.getByRole("banner");

async function openPhoneTerminal(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible({ timeout: 20_000 });
  await header(page).getByRole("button", { name: "New tab" }).click();
  await expect(page.locator("[data-terminal]")).toContainText("$", { timeout: 15_000 });
  await expect(header(page).getByRole("button", { name: "Back to agents" })).toBeVisible();
}

for (const width of [390, 320]) {
  test(`at ${width} px with 1.4.12 text spacing the terminal header holds its title rows and clears the terminal`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await openPhoneTerminal(page);
    const bar = header(page);
    // Without overrides the header keeps its 48 px: the min-height only lets it grow when its content needs more.
    expect((await bar.boundingBox())?.height).toBeCloseTo(48, 0);
    await page.addStyleTag({ content: TEXT_SPACING });
    await expect(bar.getByRole("heading", { level: 1 })).toBeVisible();

    // Nothing in the header spills out of its own box vertically: the header itself, and each of its text rows.
    const spills = await bar.evaluate((el) =>
      [el, ...el.querySelectorAll("h1, p, div")]
        .filter((node) => node.scrollHeight > node.clientHeight + 1)
        .map((node) => `${node.tagName.toLowerCase()} ${node.scrollHeight}>${node.clientHeight}`),
    );
    expect(spills).toEqual([]);

    // Every text row ends inside the header, and the header ends before the terminal's first row begins.
    const headerBox = await bar.boundingBox();
    const bottom = (headerBox?.y ?? 0) + (headerBox?.height ?? 0);
    const rows = await Promise.all([bar.getByRole("heading", { level: 1 }), bar.locator("p")].map(laidOutBox));
    for (const box of rows) expect(box.y + box.height).toBeLessThanOrEqual(bottom + 0.5);
    // The terminal can hold its prompt text before it lays out its first row, so wait for that row's box.
    const firstRow = await laidOutBox(page.locator("[data-terminal] .term-row").first());
    expect(firstRow.y).toBeGreaterThanOrEqual(bottom - 0.5);

    // The session actions stay a full touch target.
    const actions = await laidOutBox(bar.getByRole("button", { name: /^Session actions for / }));
    expect(actions.width).toBeGreaterThanOrEqual(44);
    expect(actions.height).toBeGreaterThanOrEqual(44);
  });
}
