// No box on any screen overflows, at every window the app targets, in both themes, with the layout host's long
// names, titles and paths. LAYOUT_OUT=<dir> also saves each screen and its findings there.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCREENS, STARTS } from "./layout-screens.ts";
import { findOverflows } from "./overflow.ts";
import { expect, test } from "./fixtures.ts";

const VIEWPORTS = [
  { name: "1470x956@2", viewport: { width: 1470, height: 956 }, deviceScaleFactor: 2, narrow: false },
  { name: "1280x800@2", viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, narrow: false },
  { name: "1280x800@1", viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, narrow: false },
  { name: "390x844@3", viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, narrow: true },
] as const;
/** The live terminal draws its own grid; the sidebar and the phone's list of the same rows have their own fix. */
const SKIP = ["[data-terminal]", 'aside[aria-label="Workspace"]', '[data-slot="agents-list"]'];
/** A spinning glyph's box grows as it turns; measure every box at rest. */
const AT_REST = "*, ::before, ::after { animation: none !important; transition: none !important; }";
const BROKEN_STORAGE = `IDBFactory.prototype.open = () => { throw new DOMException("IndexedDB is not available here", "InvalidStateError"); };`;
const OUT = process.env["LAYOUT_OUT"];

test.use({ page: async ({ page }, use) => use(page), serviceWorkers: "block" });

for (const { name: size, narrow, ...use } of VIEWPORTS) {
  for (const theme of ["day", "night"] as const) {
    const screens = SCREENS.filter((screen) => screen.only === undefined || (screen.only === "narrow") === narrow);
    for (const screen of screens) {
      test(`${screen.name} at ${size} in ${theme} overflows nowhere`, async ({ browser }) => {
        const context = await browser.newContext({
          ...use,
          isMobile: narrow,
          hasTouch: narrow,
          colorScheme: theme === "day" ? "light" : "dark",
        });
        const stored = STARTS[screen.start];
        await context.addInitScript(
          ([chosen, value]) => {
            localStorage.setItem("doriface.appearance", JSON.stringify({ theme: chosen, custom: [] }));
            if (value === null) localStorage.removeItem("doriface.connection");
            else localStorage.setItem("doriface.connection", value);
          },
          [theme, stored === null ? null : JSON.stringify(stored)] as const,
        );
        if (screen.storageFails === true) await context.addInitScript({ content: BROKEN_STORAGE });
        const page = await context.newPage();
        await screen.open(page, narrow);
        await page.mouse.move(0, 0);
        await page.evaluate(() => document.fonts.ready);
        await page.addStyleTag({ content: AT_REST });
        const found = await page.evaluate(findOverflows, SKIP);
        if (OUT !== undefined) {
          const file = join(OUT, `${screen.name}-${size}-${theme}`);
          mkdirSync(OUT, { recursive: true });
          await page.screenshot({ path: `${file}.png`, animations: "disabled" });
          writeFileSync(`${file}.json`, JSON.stringify(found, null, 1));
        }
        await context.close();
        expect(found).toEqual([]);
      });
    }
  }
}
