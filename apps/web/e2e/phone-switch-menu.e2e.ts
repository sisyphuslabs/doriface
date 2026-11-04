import { endAgent, startShell } from "./agents.ts";
import { expect, test } from "./fixtures.ts";
import { key, openPhoneTerminal, PHONE } from "./phone-key-bar.ts";

test.use({ serviceWorkers: "block", ...PHONE });

/** 21 shells started on the core plus the one the spec opens: more sessions than fit above the keys bar. */
const SHELLS = 21;
let shells: string[] = [];
let opened: string | null = null;
test.beforeEach(() => {
  shells = Array.from({ length: SHELLS }, (_, index) =>
    startShell("host", `many-${String(index + 1).padStart(2, "0")}`),
  );
});
test.afterEach(() => {
  for (const address of [...shells, ...(opened === null ? [] : [opened])]) endAgent("host", address);
  opened = null;
});

for (const keyboard of ["overlay", "resize"] as const) {
  test(`with ${SHELLS + 1} sessions and a ${keyboard} keyboard, Switch session fits above it and reaches the first`, async ({
    page,
  }) => {
    opened = await (await openPhoneTerminal(page, 390, keyboard)).getAttribute("data-terminal");
    // A browser that resizes the page for the keyboard: the page is 336 px shorter while it is up.
    if (keyboard === "resize") await page.setViewportSize({ width: 390, height: 844 - 336 });
    await expect(page.getByRole("toolbar", { name: "Terminal keys" })).toBeVisible();

    await key(page, "Switch session").click();
    const menu = page.getByRole("menu");
    await expect.poll(() => menu.getByRole("menuitem").count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(SHELLS + 1);
    const box = await menu.boundingBox();
    const visible = await page.evaluate(() => {
      const viewport = window.visualViewport;
      return { top: viewport?.offsetTop ?? 0, bottom: (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight) };
    });
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(Math.max(0, visible.top));
    expect((box?.y ?? 0) + (box?.height ?? Infinity)).toBeLessThanOrEqual(visible.bottom + 1);
    expect(await menu.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

    const current = menu.locator('[role="menuitem"][aria-current="true"]');
    // The menu brings the current session into view once it has opened.
    const currentShown = () =>
      current.evaluate((item) => {
        const outer = item.closest('[role="menu"]')?.getBoundingClientRect();
        const inner = item.getBoundingClientRect();
        return outer !== undefined && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
      });
    await expect.poll(currentShown, { timeout: 5_000 }).toBe(true);

    const first = menu.getByRole("menuitem").first();
    const title = (await first.locator("span").first().innerText()).trim();
    await first.scrollIntoViewIfNeeded();
    await first.click();
    await expect(page.locator("header h1")).toHaveText(title, { timeout: 15_000 });
  });
}
