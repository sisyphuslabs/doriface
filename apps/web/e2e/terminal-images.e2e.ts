import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import type { Locator, Page } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

const SIZE = 24;

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** A SIZE x SIZE PNG of one color (8-bit RGB). */
function png(rgb: readonly [number, number, number]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.from([0, ...Array.from({ length: SIZE }, () => rgb).flat()]);
  const pixels = Buffer.concat(Array.from({ length: SIZE }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const RED = [255, 0, 0] as const;
const BLUE = [0, 0, 255] as const;
const graphics = (control: string, payload = ""): string => `\u001b_G${control};${payload}\u001b\\`;
/** Kitty's own chunking: the first chunk carries the keys, the rest only `m`. */
function chunked(control: string, payload: string, size: number): string {
  const parts = payload.match(new RegExp(`.{1,${size}}`, "g")) ?? [];
  return parts
    .map((part, index) => graphics(index === 0 ? `${control},m=1` : `m=${index < parts.length - 1 ? 1 : 0}`, part))
    .join("");
}

/** Has the shell print `mark` on its own line, then `bytes` (from a file, so nothing long is typed), then `done-<mark>`. */
async function show(page: Page, terminal: Locator, mark: string, bytes: string): Promise<void> {
  const file = join(mkdtempSync(join(tmpdir(), "dh-images-")), "out");
  writeFileSync(file, bytes, "latin1");
  await terminal.getByRole("textbox").focus();
  await page.keyboard.type(`echo ${mark}; cat ${file}; echo; echo done-${mark}`);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await lines(terminal)).includes(`done-${mark}`), { timeout: 15_000 }).toBe(true);
}

const liveRows = (terminal: Locator) => terminal.locator(".term-row:not(.term-scrollback-row)");
const images = (terminal: Locator) => terminal.locator("canvas.term-image");
/** The live rows' text, each without the blank cells after it. */
const lines = async (terminal: Locator) =>
  (await liveRows(terminal).allTextContents()).map((line) => line.replace(/[\s\u00a0]+$/u, ""));

/**
 * Where the image placed right after MARK's line is drawn: the image canvas over the first cell of the row below MARK,
 * and that point's color in it.
 */
async function drawnBelow(terminal: Locator, mark: string) {
  return terminal.evaluate((root, text) => {
    const rows = [...root.querySelectorAll<HTMLElement>(".term-row:not(.term-scrollback-row)")];
    const marked = rows.find((row) => row.textContent?.trim() === text);
    if (marked === undefined) return null;
    const cell = marked.getBoundingClientRect();
    const x = cell.left + 4;
    const y = cell.bottom + 4;
    // The image layer takes no pointer events, so hit testing skips it: the canvas is found by its box.
    const hit = [...root.querySelectorAll<HTMLCanvasElement>("canvas.term-image")].find((canvas) => {
      const box = canvas.getBoundingClientRect();
      return x >= box.left && x < box.right && y >= box.top && y < box.bottom;
    });
    if (hit === undefined) {
      return { image: false, top: null, left: null, cellTop: cell.bottom, cellLeft: cell.left, rgb: null };
    }
    const box = hit.getBoundingClientRect();
    const scale = hit.width / box.width;
    const pixel = hit
      .getContext("2d")
      ?.getImageData(Math.floor((x - box.left) * scale), Math.floor((y - box.top) * scale), 1, 1).data;
    return {
      image: true,
      top: Math.round(box.top),
      left: Math.round(box.left),
      cellTop: Math.round(cell.bottom),
      cellLeft: Math.round(cell.left),
      rgb: pixel === undefined ? null : [pixel[0], pixel[1], pixel[2]],
    };
  }, mark);
}

async function expectImageBelow(terminal: Locator, mark: string, rgb: readonly number[]): Promise<void> {
  await expect
    .poll(async () => {
      const drawn = await drawnBelow(terminal, mark);
      return drawn !== null && drawn.image && drawn.top === drawn.cellTop && drawn.left === drawn.cellLeft
        ? drawn.rgb
        : drawn;
    })
    .toEqual([...rgb]);
}

test("a Kitty PNG sent directly is drawn at the cursor's cell, moves with its text, and stays on its cell through a resize", async ({
  page,
}) => {
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  await show(page, terminal, "png-direct", graphics("a=T,f=100", png(RED).toString("base64")));
  await expectImageBelow(terminal, "png-direct", RED);

  // New output scrolls the text and the image together.
  await terminal.getByRole("textbox").focus();
  await page.keyboard.type("seq 1 4");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await lines(terminal)).includes("4"), { timeout: 15_000 }).toBe(true);
  await expectImageBelow(terminal, "png-direct", RED);

  await page.setViewportSize({ width: 900, height: 600 });
  await expectImageBelow(terminal, "png-direct", RED);
});

test("a Kitty PNG transmitted in chunks and placed later is drawn, and a delete removes it", async ({ page }) => {
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  const transmit = chunked("a=t,f=100,i=31,q=2", png(BLUE).toString("base64"), 64);
  await show(page, terminal, "png-placed", `${transmit}${graphics("a=p,i=31,q=2")}`);
  await expectImageBelow(terminal, "png-placed", BLUE);

  await show(page, terminal, "png-deleted", graphics("a=d,d=A,q=2"));
  await expect(images(terminal)).toHaveCount(0);
});

test("raw RGBA is still drawn as before", async ({ page }) => {
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let at = 0; at < rgba.length; at += 4) rgba.set([255, 0, 0, 255], at);
  await show(page, terminal, "rgba", graphics(`a=T,f=32,s=${SIZE},v=${SIZE}`, rgba.toString("base64")));
  await expectImageBelow(terminal, "rgba", RED);
});

test("iTerm2 inline images and sixel are not drawn, and leave the screen's text intact", async ({ page }) => {
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  const iterm = `\u001b]1337;File=inline=1;width=20:${png(RED).toString("base64")}\u0007`;
  const sixel = "\u001bPq#0;2;100;40;0#0~~~~~~$-~~~~~~\u001b\\";
  await show(page, terminal, "unsupported", `${iterm}${sixel}after-images`);
  const text = (await lines(terminal)).join("\n");
  expect(text).toContain("unsupported\nafter-images\ndone-unsupported");
  expect(text).not.toMatch(/1337|File=|#0;2|~~~|iVBOR/);
  await expect(images(terminal)).toHaveCount(0);
});

test("closing a terminal frees its engine", async ({ page }) => {
  // Every Ghostty engine is its own WebAssembly instance; count the deinit each one's dispose() calls.
  await page.addInitScript(() => {
    const instantiate = WebAssembly.instantiate.bind(WebAssembly);
    Reflect.set(window, "engineDeinits", 0);
    Reflect.set(WebAssembly, "instantiate", async (...args: Parameters<typeof WebAssembly.instantiate>) => {
      const made: unknown = await instantiate(...args);
      if (!(made instanceof WebAssembly.Instance)) return made;
      // The exports object is frozen, so the engine gets a copy whose deinit is counted.
      const deinit = made.exports["deinit"];
      if (typeof deinit !== "function") return made;
      const exports = {
        ...made.exports,
        deinit: (...call: unknown[]) => {
          Reflect.set(window, "engineDeinits", Number(Reflect.get(window, "engineDeinits")) + 1);
          return Reflect.apply(deinit, made.exports, call);
        },
      };
      return { exports };
    });
  });
  await page.goto("/");
  await openNewTerminal(page);
  await openNewTerminal(page);
  const deinits = () => page.evaluate(() => Number(Reflect.get(window, "engineDeinits")));
  const before = await deinits();
  const tabs = page.getByRole("tablist", { name: "Tabs" }).getByRole("tab");
  const open = await tabs.count();
  // The other tab stays, so the closed one's view goes away rather than being shown again.
  await page
    .getByRole("tablist", { name: "Tabs" })
    .getByRole("button", { name: /^Close / })
    .first()
    .click();
  // Closing the tab of a running shell asks first; Keep running closes the tab and leaves the session on the core.
  await page.getByRole("dialog").getByRole("button", { name: "Keep running" }).click();
  await expect(tabs).toHaveCount(open - 1, { timeout: 20_000 });
  await expect.poll(deinits, { timeout: 15_000 }).toBeGreaterThan(before);
});
