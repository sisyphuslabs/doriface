import { expect, openNewTerminal, test } from "./fixtures.ts";
import { BLUE, chunked, expectImageBelow, graphics, images, lines, png, RED, show, SIZE } from "./terminal-images.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

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
  // Closing the tab of a shell at its prompt ends it without asking.
  await expect(tabs).toHaveCount(open - 1, { timeout: 20_000 });
  await expect.poll(deinits, { timeout: 15_000 }).toBeGreaterThan(before);
});
