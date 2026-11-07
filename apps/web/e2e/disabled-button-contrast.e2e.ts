// A disabled Button is dimmed, yet its label stays legible against the fill it is painted on, in both themes and on
// every surface it sits on (#1031): 4.5:1 for a filled Button, 3:1 for a ghost one, measured as the browser composites
// it, opacity included. A working (loading) Button is busy, not unavailable, so it keeps its own colours.
import type { Locator, Page } from "@playwright/test";
import { PAIR_CODE, PAIRING_SETTINGS } from "./capture-relay.ts";
import { expect, test } from "./fixtures.ts";
import { MACHINE_NAME } from "./machine.ts";
import { newOn, OFFLINE_BOUND_MS, OFFLINE_TEST_TIMEOUT_MS, reconnect, switchTo } from "./machine-switch.ts";

type Rgb = [number, number, number];

interface Ask {
  /** Paints the button's parent with this theme surface (`--<surface>`) first, as if the button sat on it. */
  readonly surface?: string;
  /** The ink is the button's first svg (an icon or the loading spinner) instead of its label text. */
  readonly svg?: boolean;
  /** An ink to measure this one against, e.g. the same button's while it was enabled. */
  readonly enabled?: Rgb;
}

interface Painted {
  readonly label: string;
  readonly ratio: number;
  readonly fromEnabled: number;
  /** The ink against `Ask.enabled`; 1 when none was given. */
  readonly step: number;
  readonly ink: Rgb;
}

/**
 * Composites the button's ink and its fill the way the browser paints them: each element's background under its
 * descendants, then its opacity on the whole group, up to the page. A fade on the whole button fades both together.
 */
function painted(button: Element, ask: Ask): Painted {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const paint = canvas.getContext("2d", { willReadFrequently: true });
  if (paint === null) throw new Error("no 2d canvas");
  const premultiplied = (css: string): [number, number, number, number] => {
    paint.clearRect(0, 0, 1, 1);
    paint.fillStyle = css;
    paint.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 0] = paint.getImageData(0, 0, 1, 1).data;
    const alpha = a / 255;
    return [(r / 255) * alpha, (g / 255) * alpha, (b / 255) * alpha, alpha];
  };
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- page.evaluate sends this function as source, so its helpers live inside it
  const over = (top: number[], under: number[]): number[] =>
    top.map((value, index) => value + (under[index] ?? 0) * (1 - (top[3] ?? 0)));
  /** `inner` (what sits inside `from`) composited through `from` and every ancestor, onto a white page. */
  const through = (from: Element, inner: number[]): Rgb => {
    let layer = inner;
    for (let at: Element | null = from; at !== null; at = at.parentElement) {
      const style = getComputedStyle(at);
      layer = over(layer, premultiplied(style.backgroundColor));
      const opacity = Number.parseFloat(style.opacity);
      layer = layer.map((value) => value * opacity);
    }
    const [r = 0, g = 0, b = 0] = over(layer, [1, 1, 1, 1]);
    return [r, g, b];
  };
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- as above
  const luminance = (rgb: Rgb): number => {
    const [lr = 0, lg = 0, lb = 0] = rgb.map((c) => (c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  };
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- as above
  const contrast = (a: Rgb, b: Rgb): number => {
    const [hi = 0, lo = 0] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- as above
  const hex = (rgb: Rgb): string =>
    `#${rgb
      .map((c) =>
        Math.round(c * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;

  const parent = button.parentElement;
  if (!(parent instanceof HTMLElement)) throw new Error("the button has no parent");
  const before = parent.style.backgroundColor;
  if (ask.surface !== undefined) parent.style.backgroundColor = `var(--${ask.surface})`;
  try {
    let holder: Element | null | undefined;
    if (ask.svg === true) holder = button.querySelector("svg");
    else {
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      let text = walker.nextNode();
      while (text !== null && (text.textContent ?? "").trim() === "") text = walker.nextNode();
      holder = text?.parentElement;
    }
    if (holder === null || holder === undefined) throw new Error("the button has no label or icon");
    const fill = through(holder, [0, 0, 0, 0]);
    const ink = through(holder, premultiplied(getComputedStyle(holder).color));
    const enabled = through(
      parent,
      premultiplied(getComputedStyle(document.documentElement).getPropertyValue("--primary")),
    );
    return {
      label: `${hex(ink)} on ${hex(fill)}${ask.surface === undefined ? "" : ` (--${ask.surface})`}${ask.enabled === undefined ? "" : `, enabled ${hex(ask.enabled)}`}`,
      ratio: contrast(ink, fill),
      fromEnabled: contrast(fill, enabled),
      step: ask.enabled === undefined ? 1 : contrast(ink, ask.enabled),
      ink,
    };
  } finally {
    parent.style.backgroundColor = before;
  }
}

/** Measures once the button's colour transitions have settled, with the pointer off it. */
async function measure(page: Page, button: Locator, ask: Ask = {}): Promise<Painted> {
  await page.mouse.move(0, 0);
  await button.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  return button.evaluate(painted, ask);
}

/** Every surface a filled Button sits on: the page, a card or panel, the sidebar, a raised control, a dialog or menu. */
const SURFACES = ["background", "surface", "chrome", "raised", "popover"] as const;

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });

for (const theme of ["day", "night"] as const) {
  test.describe(`${theme}, 390 px`, () => {
    test.use({ colorScheme: theme === "day" ? "light" : "dark" });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(
        (chosen) => localStorage.setItem("doriface.appearance", JSON.stringify({ theme: chosen, custom: [] })),
        theme,
      );
    });

    test("the pairing screen's disabled Pair keeps a legible label on every surface, on a fill unlike the enabled one", async ({
      page,
    }) => {
      await page.addInitScript(
        (stored) => localStorage.setItem("doriface.connection", stored),
        JSON.stringify(PAIRING_SETTINGS),
      );
      await page.goto("/pair");
      const pair = page.getByRole("button", { name: "Pair", exact: true });
      await expect(pair).toBeDisabled();
      // Each measurement paints the parent and restores it inside one synchronous page call, so they cannot interleave.
      const everywhere = await Promise.all(
        [undefined, ...SURFACES].map((surface) => measure(page, pair, surface === undefined ? {} : { surface })),
      );
      for (const measured of everywhere) {
        expect(measured.ratio, measured.label).toBeGreaterThanOrEqual(4.5);
        expect(measured.fromEnabled, measured.label).toBeGreaterThanOrEqual(3);
      }
    });

    test("offline, the first-run's disabled Pair a host keeps a legible label", async ({ page, context }) => {
      await page.addInitScript(() => localStorage.removeItem("doriface.connection"));
      await page.goto("/");
      await context.setOffline(true);
      const button = page.getByRole("button", { name: "Pair a host" });
      await expect(button).toBeDisabled();
      const measured = await measure(page, button);
      await context.setOffline(false);
      expect(measured.ratio, measured.label).toBeGreaterThanOrEqual(4.5);
    });

    test("Pair keeps its primary colours while it looks the code up: it is working, not unavailable", async ({
      page,
    }) => {
      await page.addInitScript(
        (stored) => localStorage.setItem("doriface.connection", stored),
        JSON.stringify(PAIRING_SETTINGS),
      );
      // The lookup is never answered, so Pair stays busy for as long as the test looks at it.
      await page.route("https://relay-doriface.omo.dev/v1/pair/*", () => undefined);
      await page.goto("/pair");
      await page.getByLabel("Pairing code").fill(PAIR_CODE);
      const pair = page.getByRole("button", { name: "Pair", exact: true });
      await pair.click();
      await expect(pair).toHaveAttribute("aria-busy", "true");
      const measured = await measure(page, pair, { svg: true });
      // Its fill is the enabled primary fill, and its spinner is drawn in the primary label colour on it.
      expect(measured.fromEnabled, measured.label).toBeLessThan(1.05);
      expect(measured.ratio, measured.label).toBeGreaterThanOrEqual(4.5);
    });
  });

  test.describe(`${theme}, 1440 px`, () => {
    test.use({ colorScheme: theme === "day" ? "light" : "dark", viewport: { width: 1440, height: 900 } });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(
        (chosen) => localStorage.setItem("doriface.appearance", JSON.stringify({ theme: chosen, custom: [] })),
        theme,
      );
    });
    test.afterEach(() => reconnect());

    test("an offline machine's New space icon is dimmed a visible step from the enabled one, still 3:1 on the sidebar", async ({
      page,
    }) => {
      test.setTimeout(OFFLINE_TEST_TIMEOUT_MS);
      await page.goto("/");
      const add = newOn(page);
      await expect(add).toBeEnabled({ timeout: 20_000 });
      const enabled = await measure(page, add, { svg: true });
      switchTo("drop");
      await expect(add, `${MACHINE_NAME} goes offline`).toBeDisabled({ timeout: OFFLINE_BOUND_MS });
      const disabled = await measure(page, add, { svg: true, enabled: enabled.ink });
      expect(disabled.ratio, disabled.label).toBeGreaterThanOrEqual(3);
      // The 3:1 floor caps how far a ghost glyph can dim (the enabled one is 5.3:1 to 7.3:1 on the sidebar).
      expect(disabled.step, disabled.label).toBeGreaterThanOrEqual(1.7);
    });
  });
}
