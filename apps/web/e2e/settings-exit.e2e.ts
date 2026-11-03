import type { Page } from "@playwright/test";
import { expect, terminalCount, test } from "./fixtures.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

/** Mirrored from apps/desktop/src/config/window.ts: the macOS window buttons and the inset the shell sets. */
const TRAFFIC_LIGHTS = { x: 12, y: 16, width: 54, height: 16 } as const;
const MAC_TITLEBAR_CSS = ":root { --titlebar-inset-start: 78px; }";

const AIR_VIEWPORTS = [
  { width: 1470, height: 956 },
  { width: 1280, height: 800 },
] as const;

/** Opens Settings from the workspace the way a person does, so there is a view to return to. */
async function openSettings(page: Page): Promise<void> {
  await page.goto("/");
  await terminalCount(page);
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
}

async function expectWorkspace(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("complementary", { name: "Workspace" })).toBeVisible();
}

const closeControl = (page: Page) => page.getByRole("button", { name: "Close settings" }).first();

for (const viewport of AIR_VIEWPORTS) {
  test.describe(`at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, deviceScaleFactor: 2 });

    test("Escape closes Settings and returns to the workspace", async ({ page }) => {
      await openSettings(page);
      await page.keyboard.press("Escape");
      await expectWorkspace(page);
    });

    test("the settings shortcut toggles Settings closed", async ({ page }) => {
      await openSettings(page);
      await page.keyboard.press("ControlOrMeta+Comma");
      await expectWorkspace(page);
    });

    test("Escape closes an open dialog first, then Settings", async ({ page }) => {
      await openSettings(page);
      await page.getByRole("button", { name: "Keybindings", exact: true }).click();
      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "Import keybinds…" }).click();
      await (
        await chooser
      ).setFiles({ name: "keybinds", mimeType: "text/plain", buffer: Buffer.from("keybind = super+t=new_tab\n") });
      const dialog = page.getByRole("dialog", { name: "Import these keybindings?" });
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(/\/settings$/);
      await page.keyboard.press("Escape");
      await expectWorkspace(page);
    });

    test("Escape cancels a shortcut recording first, then closes Settings", async ({ page }) => {
      await openSettings(page);
      await page.getByRole("button", { name: "Keybindings", exact: true }).click();
      await page.getByRole("button", { name: "Record a shortcut for New tab" }).click();
      await expect(page.getByRole("status")).toHaveText("Press keys…");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("status")).toBeHidden();
      await expect(page).toHaveURL(/\/settings$/);
      await expect(page.getByText("Changed")).toBeHidden();
      await page.keyboard.press("Escape");
      await expectWorkspace(page);
    });

    test("the close control clears the macOS window buttons and names its shortcut", async ({ page }) => {
      // The desktop shell injects this stylesheet under its hidden-inset titlebar.
      await page.addInitScript((css) => {
        document.addEventListener("DOMContentLoaded", () => {
          const style = document.createElement("style");
          style.textContent = css;
          document.head.append(style);
        });
      }, MAC_TITLEBAR_CSS);
      await page.goto("/settings");
      const control = closeControl(page);
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      const lights = TRAFFIC_LIGHTS;
      const clear = box === null || box.x >= lights.x + lights.width || box.y >= lights.y + lights.height;
      expect(clear, `close control at ${JSON.stringify(box)} sits under the window buttons`).toBe(true);
      await control.hover();
      await expect(page.getByText(/^Close settings\s*Esc$/)).toBeVisible();
      await control.click();
      await expect(page).toHaveURL(/\/$/);
    });
  });
}
