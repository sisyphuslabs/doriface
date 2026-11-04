import type { Page } from "@playwright/test";
import { startShell } from "./agents.ts";
import { expect, test } from "./fixtures.ts";
import { fractionOf, paneOf, seedLayout, type Fraction, type SeedTab } from "./layout-doc.ts";
import { hcOn } from "./machine-switch.ts";

test.use({ serviceWorkers: "block" });

type Platform = "mac" | "other";

/** Ghostty's resize and equalize keys (⌘⌃ on macOS; Ctrl+Alt+Shift off it, since Super is the OS's), zoom as both. */
const KEYS: Readonly<Record<Platform, Readonly<Record<"grow" | "equalize" | "zoom" | "close", string>>>> = {
  mac: { grow: "Meta+Control+ArrowDown", equalize: "Meta+Control+Equal", zoom: "Meta+Shift+Enter", close: "Meta+w" },
  other: {
    grow: "Control+Alt+Shift+ArrowDown",
    equalize: "Control+Alt+Equal",
    zoom: "Control+Shift+Enter",
    close: "Control+Shift+X",
  },
};

const shells: string[] = [];
test.afterEach(() => {
  for (const address of shells.splice(0)) hcOn("host", ["kill", address]);
});

const shell = (name: string): string => {
  const address = startShell("host", `resize-${name}`);
  shells.push(address);
  return address;
};

/** one | (two / (three | (four / five))), what herdr-app writes for ⌘D ⌘⇧D ⌘D ⌘⇧D. */
function deepTab(t: readonly string[]): SeedTab {
  const [t1 = "", t2 = "", t3 = "", t4 = "", t5 = ""] = t;
  return {
    id: "tb-deep",
    name: "deep",
    root: [
      { pane: "p1", terminal: t1, weight: 0.5 },
      {
        id: "s-col",
        axis: "column",
        weight: 0.5,
        children: [
          { pane: "p2", terminal: t2 },
          {
            id: "s-row",
            axis: "row",
            children: [
              { pane: "p3", terminal: t3 },
              {
                id: "s-deep",
                axis: "column",
                children: [
                  { pane: "p4", terminal: t4 },
                  { pane: "p5", terminal: t5 },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

const near = (a: Fraction, b: Partial<Fraction>, tolerance = 0.03): boolean =>
  (["x", "y", "w", "h"] as const).every((key) => b[key] === undefined || Math.abs(a[key] - (b[key] ?? 0)) <= tolerance);

async function expectAt(page: Page, address: string, want: Partial<Fraction>): Promise<void> {
  await expect
    .poll(
      async () => {
        const actual = await fractionOf(page, address).catch(() => null);
        return actual !== null && near(actual, want) ? "ok" : JSON.stringify(actual);
      },
      { timeout: 15_000 },
    )
    .toBe("ok");
}

async function setPlatform(page: Page, platform: Platform): Promise<void> {
  if (platform === "mac") {
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel" }));
  }
}

for (const platform of ["mac", "other"] as const) {
  test(`${platform}: a deep divider resizes by drag, by its arrow keys and by the resize keys; equalize evens it; sizes outlive a reload; zoom fills the tab`, async ({
    page,
  }) => {
    const t = ["1", "2", "3", "4", "5"].map(shell);
    const [, , , four = "", five = ""] = t;
    seedLayout([deepTab(t)]);
    await setPlatform(page, platform);
    await page.goto("/");
    await expectAt(page, four, { y: 0.5, h: 0.25 });

    const divider = page.locator('[role="separator"][data-container="s-deep"]');
    await expect(divider).toHaveAttribute("aria-orientation", "horizontal");
    const [line, panel] = [await divider.boundingBox(), await page.locator('[role="tabpanel"]:visible').boundingBox()];
    if (line === null || panel === null) throw new Error("no divider or panel box");
    await page.mouse.move(line.x + line.width / 2, line.y + line.height / 2);
    await page.mouse.down();
    await page.mouse.move(line.x + line.width / 2, line.y + line.height / 2 + panel.height * 0.1, { steps: 8 });
    await page.mouse.up();
    await expectAt(page, four, { h: 0.35 });
    await expectAt(page, five, { y: 0.85, h: 0.15 });

    await page.reload();
    await expectAt(page, four, { h: 0.35 });

    await divider.focus();
    await page.keyboard.press("ArrowUp");
    await expectAt(page, four, { h: 0.3 });

    await paneOf(page, four).getByRole("textbox").focus();
    await page.keyboard.press(KEYS[platform].grow);
    await expectAt(page, four, { h: 0.35 });

    await page.keyboard.press(KEYS[platform].equalize);
    await expectAt(page, four, { y: 0.5, h: 0.25 });
    await expectAt(page, five, { y: 0.75, h: 0.25 });

    await page.keyboard.press(KEYS[platform].zoom);
    await expectAt(page, four, { x: 0, y: 0, w: 1, h: 1 });
    await expect(paneOf(page, five)).toBeHidden();
    await page.keyboard.press(KEYS[platform].zoom);
    await expectAt(page, five, { y: 0.75, h: 0.25 });
  });
}

test("closing a pane in the middle gives its space to its neighbour and focus to the pane before; the last closes the tab", async ({
  page,
}) => {
  const t = ["1", "2", "3", "4", "5"].map(shell);
  const [one = "", two = "", three = "", four = "", five = ""] = t;
  const other = shell("other");
  seedLayout([deepTab(t), { id: "tb-other", name: "other", root: [{ pane: "p6", terminal: other }] }]);
  await page.goto("/");
  await expectAt(page, three, { x: 0.5, y: 0.5, w: 0.25 });
  const tabs = page.getByRole("tablist", { name: "Tabs" }).getByRole("tab");
  await expect(tabs).toHaveCount(2);

  await paneOf(page, two).getByRole("textbox").focus();
  await paneOf(page, three).getByRole("textbox").focus();
  await paneOf(page, three).getByRole("button", { name: "Close pane" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Keep running" }).click();
  await expect(paneOf(page, three)).toHaveCount(0);
  // The column of four and five takes three's place, the whole bottom right.
  await expectAt(page, four, { x: 0.5, y: 0.5, w: 0.5, h: 0.25 });
  await expectAt(page, five, { x: 0.5, y: 0.75, w: 0.5, h: 0.25 });
  await expect(page.locator('[data-focused="true"] [data-terminal]')).toHaveAttribute("data-terminal", two);

  await [two, four, five, one].reduce<Promise<void>>(async (previous, address) => {
    await previous;
    await paneOf(page, address).getByRole("textbox").focus();
    await page.keyboard.press(KEYS.other.close);
    await page.getByRole("dialog").getByRole("button", { name: "Keep running" }).click();
    await expect(paneOf(page, address)).toHaveCount(0);
  }, Promise.resolve());
  await expect(tabs).toHaveCount(1);
  await expect(tabs.first()).toHaveText(/other/);
});
