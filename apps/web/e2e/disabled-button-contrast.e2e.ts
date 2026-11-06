// A disabled Button is dimmed, yet its label stays legible text against the fill it is painted on, in both themes
// (#1031): 4.5:1 against its own fill, measured as the browser composites it, opacity included.
import type { Locator } from "@playwright/test";
import { PAIRING_SETTINGS } from "./capture-relay.ts";
import { expect, test } from "./fixtures.ts";

interface Painted {
  readonly label: string;
  readonly ratio: number;
  readonly fromEnabled: number;
}

/**
 * Composites the button's label and its fill the way the browser paints them: each element's background under its
 * descendants, then its opacity on the whole group, up to the page. A fade on the whole button fades both together.
 */
function painted(button: Element): Painted {
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
  const through = (from: Element, inner: number[]): [number, number, number] => {
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
  const luminance = (rgb: [number, number, number]): number => {
    const [lr = 0, lg = 0, lb = 0] = rgb.map((c) => (c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  };
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- as above
  const contrast = (a: [number, number, number], b: [number, number, number]): number => {
    const [hi = 0, lo = 0] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- as above
  const hex = (rgb: [number, number, number]): string =>
    `#${rgb
      .map((c) =>
        Math.round(c * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;

  const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
  let text = walker.nextNode();
  while (text !== null && (text.textContent ?? "").trim() === "") text = walker.nextNode();
  const holder = text?.parentElement;
  if (holder === null || holder === undefined) throw new Error("the button has no label");
  const fill = through(holder, [0, 0, 0, 0]);
  const label = through(holder, premultiplied(getComputedStyle(holder).color));
  const parent = button.parentElement;
  if (parent === null) throw new Error("the button has no parent");
  const enabled = through(
    parent,
    premultiplied(getComputedStyle(document.documentElement).getPropertyValue("--primary")),
  );
  return { label: `${hex(label)} on ${hex(fill)}`, ratio: contrast(label, fill), fromEnabled: contrast(fill, enabled) };
}

async function measure(button: Locator): Promise<Painted> {
  await expect(button).toBeDisabled();
  return button.evaluate(painted);
}

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

    test("the pairing screen's disabled Pair keeps a legible label on a fill unlike the enabled one", async ({
      page,
    }) => {
      await page.addInitScript(
        (stored) => localStorage.setItem("doriface.connection", stored),
        JSON.stringify(PAIRING_SETTINGS),
      );
      await page.goto("/pair");
      const measured = await measure(page.getByRole("button", { name: "Pair", exact: true }));
      expect(measured.ratio, measured.label).toBeGreaterThanOrEqual(4.5);
      expect(measured.fromEnabled, measured.label).toBeGreaterThanOrEqual(3);
    });

    test("offline, the first-run's disabled Pair a host keeps a legible label", async ({ page, context }) => {
      await page.addInitScript(() => localStorage.removeItem("doriface.connection"));
      await page.goto("/");
      await context.setOffline(true);
      const measured = await measure(page.getByRole("button", { name: "Pair a host" }));
      await context.setOffline(false);
      expect(measured.ratio, measured.label).toBeGreaterThanOrEqual(4.5);
    });
  });
}
