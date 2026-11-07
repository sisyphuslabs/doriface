import type { Locator, Page } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";

// The default stack, with no Korean font injected: this is the path a macOS user takes, where the only face that
// covers Hangul is a proportional one. Every other Korean e2e loads its own Plex subset, so none of them can see it.
test.use({ serviceWorkers: "block", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const LINE = "A 한글 tail B";
const HANGUL = /^[한글]$/u;

const octalOf = (text: string): string =>
  [...new TextEncoder().encode(text)].map((byte) => `\\${byte.toString(8)}`).join("");

async function hangulTerminal(page: Page): Promise<Locator> {
  await page.addInitScript(() => Object.defineProperty(navigator, "platform", { value: "MacIntel" }));
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  await terminal.getByRole("textbox").focus();
  await page.keyboard.type(`printf '\\033[2J\\033[H${octalOf(LINE)}\\n'`);
  await page.keyboard.press("Enter");
  await expect(terminal.locator(".term-row").filter({ hasText: LINE })).toHaveCount(1, { timeout: 30_000 });
  return terminal;
}

interface Metrics {
  readonly cell: number;
  readonly asciiInk: number;
  readonly wide: readonly {
    readonly text: string;
    readonly box: number;
    readonly ink: number;
    readonly fill: number;
    readonly painted: number;
  }[];
  readonly latin: { readonly ink: number; readonly fill: number; readonly painted: number };
}

const metricsOf = (terminal: Locator): Promise<Metrics> =>
  terminal.evaluate((root) => {
    const row = root.querySelector(".term-row");
    if (row === null) throw new Error("no row");
    const wide = [...row.querySelectorAll(".term-wide")];
    const sample = wide[0] ?? row.children[0];
    if (sample === undefined) throw new Error("no sample");
    const cell = Number.parseFloat(getComputedStyle(root).getPropertyValue("--term-cell-width"));
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("no canvas to measure ink with");
    const ORIGIN = 12;
    const BASELINE = 44;
    const inkOf = (
      text: string,
      font: string,
    ): { readonly height: number; readonly width: number; readonly painted: number } => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.font = font;
      context.fillStyle = "#000";
      context.fillText(text, ORIGIN, BASELINE);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let top = canvas.height;
      let bottom = -1;
      let left = canvas.width;
      let right = -1;
      let painted = 0;
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const alpha = pixels[(y * canvas.width + x) * 4 + 3] ?? 0;
          if (alpha > 40) {
            painted += 1;
            if (y < top) top = y;
            if (y > bottom) bottom = y;
            if (x < left) left = x;
            if (x > right) right = x;
          }
        }
      }
      const height = bottom < top ? 0 : bottom - top + 1;
      const width = right < left ? 0 : right - left + 1;
      return { height, width, painted };
    };
    const latinSample = row.children[0] ?? sample;
    const latinStyle = getComputedStyle(latinSample);
    const latinFont = `${latinStyle.fontSize} ${latinStyle.fontFamily}`;
    let ascent = 0;
    let descent = 0;
    for (let code = 0x21; code < 0x7f; code += 1) {
      context.font = latinFont;
      const ink = context.measureText(String.fromCharCode(code));
      ascent = Math.max(ascent, ink.actualBoundingBoxAscent);
      descent = Math.max(descent, ink.actualBoundingBoxDescent);
    }
    return {
      cell,
      asciiInk: ascent + descent,
      wide: wide.map((node) => {
        const drawn = getComputedStyle(node);
        const measured = inkOf(node.textContent ?? "", `${drawn.fontSize} ${drawn.fontFamily}`);
        return {
          text: node.textContent ?? "",
          box: node.getBoundingClientRect().width,
          ink: measured.height,
          fill: measured.width,
          painted: measured.painted,
        };
      }),
      latin: (() => {
        const measured = inkOf("H", latinFont);
        return { ink: measured.height, fill: measured.width, painted: measured.painted };
      })(),
    };
  });

test("a committed Hangul syllable paints the ink height of the Latin beside it (#1245)", async ({ page }) => {
  const terminal = await hangulTerminal(page);
  await expect(terminal.locator(".term-wide").filter({ hasText: HANGUL })).toHaveCount(2);
  const metrics = await metricsOf(terminal);
  expect(metrics.wide.length).toBeGreaterThanOrEqual(2);
  expect(metrics.asciiInk).toBeGreaterThan(0);
  const latinDensity = metrics.latin.painted / (metrics.latin.fill * metrics.latin.ink);
  for (const glyph of metrics.wide) {
    const where = `${glyph.text}: box ${glyph.box}px, ink ${glyph.ink}px by ${glyph.fill}px, ${glyph.painted} painted`;
    expect(glyph.box, `${glyph.text} spans two cells`).toBeCloseTo(metrics.cell * 2, 0);
    expect(glyph.ink / metrics.asciiInk, `${where} against Latin ink ${metrics.asciiInk}px`).toBeGreaterThanOrEqual(
      0.9,
    );
    expect(glyph.fill / glyph.box, `${where} fills its cells`).toBeGreaterThanOrEqual(0.8);
    const density = glyph.painted / (glyph.fill * glyph.ink);
    expect(density, `${where} against Latin density ${latinDensity.toFixed(3)}`).toBeGreaterThan(0);
  }
});

test("the composing box spans the two cells a wide syllable takes (#1245)", async ({ page }) => {
  const terminal = await hangulTerminal(page);
  const field = terminal.getByRole("textbox");
  await field.focus();
  const cdp = await page.context().newCDPSession(page);
  const cell = await terminal.evaluate((root) =>
    Number.parseFloat(getComputedStyle(root).getPropertyValue("--term-cell-width")),
  );
  const before = await field.boundingBox();
  if (before === null) throw new Error("the field has no box");
  await cdp.send("Input.imeSetComposition", { text: "한", selectionStart: 1, selectionEnd: 1 });
  await expect
    .poll(
      async () => {
        const box = await field.boundingBox();
        return box === null ? 0 : Math.round(box.width);
      },
      { timeout: 5_000 },
    )
    .toBeGreaterThan(0);
  console.error(
    "PROBE " +
      JSON.stringify(
        await field.evaluate((el) => {
          const s = getComputedStyle(el);
          const c = document.createElement("canvas").getContext("2d");
          if (c === null) return "no canvas";
          c.font = `${s.fontSize} ${s.fontFamily}`;
          const canvasAdvance = c.measureText("한").width;
          c.font = s.fontSize + " sans-serif";
          const sansAdvance = c.measureText("한").width;
          const probe = document.createElement("span");
          probe.style.font = s.font;
          probe.style.whiteSpace = "pre";
          probe.textContent = "한";
          document.body.appendChild(probe);
          const spanWidth = probe.getBoundingClientRect().width;
          probe.remove();
          return {
            font: s.font.slice(0, 40),
            canvasAdvance,
            sansAdvance,
            spanWidth,
            cell: Number.parseFloat(
              getComputedStyle(el.closest(".terminal") ?? el).getPropertyValue("--term-cell-width"),
            ),
          };
        }),
      ),
  );
  console.error(
    "PREEDIT " +
      JSON.stringify({
        value: await field.inputValue(),
        width: (await field.boundingBox())?.width,
        cell,
        font: await field.evaluate((el) => getComputedStyle(el).fontFamily),
        fontSize: await field.evaluate((el) => getComputedStyle(el).fontSize),
        scrollWidth: await field.evaluate((el) => (el as HTMLTextAreaElement).scrollWidth),
      }),
  );
  const composing = await field.boundingBox();
  if (composing === null) throw new Error("the field has no box while composing");
  await cdp.send("Input.insertText", { text: "한" });
  expect(composing.width, "the composing box spans two cells").toBeCloseTo(cell * 2, 0);
});
