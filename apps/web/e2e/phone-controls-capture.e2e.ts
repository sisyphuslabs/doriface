// Visual QA captures of the phone terminal's controls: the keys bar, its scrolled end, the input field and a held
// selection. CAPTURE=1 bunx playwright test phone-controls-capture
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";
import { key, keysBar, openPhoneTerminal, PHONE } from "./phone-key-bar.ts";
import { pointOn } from "./terminal-points.ts";
import { Touch } from "./touch.ts";

const OUT = join(import.meta.dirname, "../../../docs/design/app");
/** The fake soft keyboard's height (phone-key-bar.ts), so a capture shows where the keyboard sits. */
const KEYBOARD_HEIGHT = 336;

test.skip(process.env["CAPTURE"] !== "1", "captures run only with CAPTURE=1");
test.use({ serviceWorkers: "block", ...PHONE, permissions: ["clipboard-read", "clipboard-write"] });

/**
 * Headless Chromium has no soft keyboard, so the room one takes is drawn as a hatched band: the keys bar rides on its
 * top edge, and the terminal ends above both.
 */
async function keyboardStandIn(page: Parameters<typeof openPhoneTerminal>[0]): Promise<void> {
  await page.evaluate((height) => {
    const band = document.createElement("div");
    band.setAttribute("data-slot", "keyboard-stand-in");
    band.setAttribute("aria-hidden", "true");
    band.style.cssText = [
      "position:fixed",
      "left:0",
      "right:0",
      "bottom:0",
      `height:${height}px`,
      "z-index:40",
      "pointer-events:none",
      "border-top:1px solid rgb(128 128 128 / 35%)",
      "background:repeating-linear-gradient(45deg, rgb(128 128 128 / 18%) 0 6px, transparent 6px 14px)",
    ].join(";");
    document.body.appendChild(band);
  }, KEYBOARD_HEIGHT);
}

async function shot(page: Parameters<typeof openPhoneTerminal>[0], name: string, theme: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: join(OUT, `phone-controls-${name}-390-${theme}.png`), animations: "disabled" });
}

for (const theme of ["day", "night"] as const) {
  test(`phone controls ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme === "day" ? "light" : "dark" });
    await page.addInitScript(
      (chosen) => localStorage.setItem("doriface.appearance", JSON.stringify({ theme: chosen, custom: [] })),
      theme,
    );
    const terminal = await openPhoneTerminal(page);
    await expect(keysBar(page)).toBeVisible();
    await page.keyboard.type("printf 'release-%s\\n' 'the build is green'\r");
    await expect(terminal).toContainText("the build is green", { timeout: 15_000 });
    await keyboardStandIn(page);
    await shot(page, "keys", theme);

    const scroller = page.locator('[data-slot="terminal-keys-scroll"]');
    await scroller.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    await shot(page, "keys-end", theme);
    await scroller.evaluate((el) => el.scrollTo({ left: 0 }));

    const field = key(page, "Type in a field");
    if ((await field.count()) === 0) return;
    await field.click();
    await expect(page.getByLabel("Type into the terminal")).toBeFocused();
    await page.keyboard.type("echo ready");
    await shot(page, "composer", theme);
    await key(page, "Send").click();
    await expect(terminal).toContainText("ready", { timeout: 15_000 });

    const word = await pointOn(terminal, "the build is green", "build");
    const touch = await Touch.on(page);
    await touch.down(word);
    await expect(page.locator(".term-selection-cells > div").first()).toBeVisible();
    await touch.up(word);
    await expect(page.getByRole("menu", { name: "Selected text" })).toBeVisible();
    await shot(page, "selection", theme);
  });
}
