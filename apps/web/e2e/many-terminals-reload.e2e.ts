import type { Page } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

const TABS = 40;
const RELOADS = 3;
const TERMINALS_PER_ENGINE = 8;

/** Counts the WebAssembly instances this page load creates: each holds a memory the process has a budget for. */
async function countInstances(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const instantiate = WebAssembly.instantiate.bind(WebAssembly);
    let created = 0;
    Object.assign(window, { wasmInstances: () => created });
    Object.defineProperty(WebAssembly, "instantiate", {
      configurable: true,
      value: (...args: Parameters<typeof WebAssembly.instantiate>) => {
        created += 1;
        return instantiate(...args);
      },
    });
  });
}

const instances = (page: Page): Promise<number> =>
  page.evaluate(() => (Reflect.get(window, "wasmInstances") as () => number)());

/**
 * #318: each terminal's engine used to be its own WebAssembly instance with its own memory, so a page with many
 * terminals took one memory reservation each, and a reload stacked the new page's on the old one's until the process
 * had none left ("WebAssembly.instantiate(): Out of memory"). Hidden tabs stay mounted, so every tab holds an engine.
 * Whether a given browser runs out depends on its reservation budget, so the test also counts the instances: terminals
 * share engines, a few per instance.
 */
test("a page with many terminals renders every pane after reload after reload, on a few shared engines", async ({
  page,
}) => {
  test.setTimeout(TABS * 4_000 + RELOADS * 40_000 + 60_000);
  await countInstances(page);
  await page.goto("/");
  // oxlint-disable-next-line no-await-in-loop -- each new tab is opened from the one before, as a person would
  for (let opened = 0; opened < TABS; opened += 1) await openNewTerminal(page);
  const failed = page.getByText("The terminal renderer failed to load");
  await expect(failed).toHaveCount(0);
  for (let reload = 1; reload <= RELOADS; reload += 1) {
    // oxlint-disable-next-line no-await-in-loop -- reloads are sequential: each stacks on what the last one left
    await page.reload();
    // oxlint-disable-next-line no-await-in-loop -- see above
    await expect(page.locator('[data-focused="true"] [data-terminal]')).toContainText("$", { timeout: 30_000 });
    const terminals = page.locator("[data-terminal]");
    // Every kept tab mounts again: as many terminals as before the reload.
    // oxlint-disable-next-line no-await-in-loop -- see above
    await expect.poll(() => terminals.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(TABS);
    // oxlint-disable-next-line no-await-in-loop -- see above
    await expect(failed, `renderer errors after reload ${reload}`).toHaveCount(0, { timeout: 15_000 });
    // oxlint-disable-next-line no-await-in-loop -- see above
    const mounted = await terminals.count();
    // oxlint-disable-next-line no-await-in-loop -- see above
    const created = await instances(page);
    expect(created, `engine instances for ${mounted} terminals after reload ${reload}`).toBeLessThanOrEqual(
      Math.ceil(mounted / TERMINALS_PER_ENGINE),
    );
  }
});
