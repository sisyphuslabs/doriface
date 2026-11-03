import { expect, test } from "./fixtures.ts";
import { LONG_MACHINE, machineConnected, renameMachine, SEEDS, SHARED_SPACE, start, stop } from "./sidebar-seed.ts";

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
  await expect(focused).toHaveAttribute("data-terminal", /^t\d+$/, { timeout: 15_000 });
  await expect(here).toHaveAttribute("aria-current", "true");
  await expect(spaces.locator('[aria-current="true"]')).toHaveCount(1);

  await there.click();
  await expect(focused).toHaveAttribute("data-terminal", new RegExp(`^${LONG_MACHINE}/t\\d+$`), { timeout: 15_000 });
  await expect(there).toHaveAttribute("aria-current", "true");
  await expect(spaces.locator('[aria-current="true"]')).toHaveCount(1);
});
