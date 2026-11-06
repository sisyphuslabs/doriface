// Captures of the space reorder (#610), at both widths and in both themes: the row's menu with Move up and Move down,
// and the sidebar's list itself. Run with CAPTURE=1 bunx playwright test space-order-capture.
import { devices } from "@playwright/test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { endAgent } from "./agents.ts";
import { E2E_HOST_PORT, E2E_TOKEN } from "./config.ts";
import { expect, test } from "./fixtures.ts";
import { seedSpaces } from "./layout-doc.ts";
import { hcOn } from "./machine-switch.ts";

test.skip(process.env["CAPTURE"] !== "1", "captures run only with CAPTURE=1");
test.use({ serviceWorkers: "block" });

const OUT = join(import.meta.dirname, "../../../docs/design/app");
const sidebar = (page: Page) => page.getByRole("complementary", { name: "Workspace" });
const spaceRow = (page: Page, name: string) =>
  sidebar(page).getByRole("button", { name: new RegExp(`^${name}(?: |$)`) });

const started: string[] = [];
test.afterEach(() => {
  for (const address of started.splice(0)) endAgent("host", address);
});

/** A shell of this capture's own, in `folder`, killed once the shot is taken. */
function startShellIn(name: string, folder: string): string {
  const out = hcOn("host", ["run", "--bg", "--name", `capture-${name}`, "--cwd", folder, "--", "env", "PS1=$ ", "sh"]);
  const address = String((JSON.parse(out) as { address: string }).address);
  started.push(address);
  return address;
}

/** Three spaces of this machine, each with its own shell in a folder of its own: a list worth reordering. */
function threeSpaces(): void {
  const root = mkdtempSync(join(tmpdir(), "space-order-capture-"));
  const space = (name: string) => {
    const id = `spc-${name.toLowerCase()}`;
    const folder = mkdtempSync(join(root, `${name}-`));
    return {
      id,
      name,
      folder,
      tabs: [{ id: `tb-${id}`, name: `${name} tab`, terminal: startShellIn(name.toLowerCase(), folder) }],
    };
  };
  seedSpaces([space("Alpha"), space("Beta"), space("Gamma")]);
}

mkdirSync(OUT, { recursive: true });

for (const width of ["1440", "390"] as const) {
  for (const theme of ["day", "night"] as const) {
    test(`space order ${width} ${theme}`, async ({ browser }) => {
      const context = await browser.newContext({
        ...(width === "1440" ? { viewport: { width: 1440, height: 900 } } : devices["iPhone 14"]),
        colorScheme: theme === "day" ? "light" : "dark",
      });
      await context.addInitScript(
        ([chosen, stored]) => {
          localStorage.setItem("doriface.appearance", JSON.stringify({ theme: chosen, custom: [] }));
          localStorage.setItem("doriface.connection", stored);
        },
        [
          theme,
          JSON.stringify({
            mode: "loopback",
            relayUrl: "",
            directUrl: "",
            hostId: "",
            loopbackUrl: `ws://127.0.0.1:${E2E_HOST_PORT}/v1/hc`,
            token: E2E_TOKEN,
          }),
        ] as const,
      );
      const page = await context.newPage();
      try {
        threeSpaces();
        await page.goto("/");
        if (width === "1440") {
          await expect(spaceRow(page, "Beta")).toBeVisible({ timeout: 20_000 });
          await spaceRow(page, "Beta").hover();
          await sidebar(page).getByRole("button", { name: "More for Beta" }).click();
          await expect(page.getByRole("menuitem", { name: "Move up" })).toBeEnabled();
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({ path: join(OUT, `space-order-menu-${width}-${theme}.png`) });
          await page.keyboard.press("Escape");
        } else {
          // Below md the shell is the phone's - a title bar, the terminal and its own bar - with no sidebar to reorder.
          await expect(page.locator("[data-titlebar]").first()).toBeVisible({ timeout: 20_000 });
        }
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: join(OUT, `space-order-${width}-${theme}.png`) });
      } finally {
        await context.close();
      }
    });
  }
}
