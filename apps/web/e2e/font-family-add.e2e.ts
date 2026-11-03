import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

const openTerminalSettings = async (page: Page) => {
  await page.goto("/settings");
  await page
    .getByRole("tab", { name: "Terminal" })
    .or(page.getByRole("button", { name: "Terminal" }))
    .first()
    .click();
};
const addButton = (page: Page, key: string) => page.getByRole("button", { name: `Add ${key}`, exact: true });

test("adding a font-family puts the cursor in the new field, and Enter hands focus back to Add", async ({ page }) => {
  await openTerminalSettings(page);
  const add = page.getByRole("button", { name: "Add font-family", exact: true });
  await add.click();
  const field = page.getByPlaceholder("Family name");
  await expect(field).toBeFocused();

  await page.keyboard.type("Courier New");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "font-family" }).last()).toHaveValue("Courier New");
  await expect(add).toBeFocused();
});

test("an Enter that leaves the new field open does not pull a later Tab back to Add", async ({ page }) => {
  await openTerminalSettings(page);

  await addButton(page, "font-family").click();
  await page.keyboard.press("Enter");
  await page.keyboard.type("Menlo");
  await page.keyboard.press("Tab");
  await expect(addButton(page, "font-family-bold")).toBeFocused();
  await expect(page.getByRole("textbox", { name: "font-family" }).last()).toHaveValue("Menlo");

  await addButton(page, "font-feature").click();
  const feature = page.getByPlaceholder("-calt");
  await page.keyboard.type("!!!");
  await page.keyboard.press("Enter");
  await expect(feature).toBeFocused();
  await feature.fill("-calt");
  await page.keyboard.press("Tab");
  await expect(addButton(page, "font-variation")).toBeFocused();
});
