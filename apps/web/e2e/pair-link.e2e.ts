import { BAD_LINK } from "./capture-relay.ts";
import { expect, test } from "./fixtures.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

test("an unusable pairing link leads on to typing the code", async ({ page }) => {
  await page.goto(BAD_LINK);
  await expect(page.getByText("This pairing link cannot be used")).toBeVisible();
  await page.getByRole("link", { name: "Type a pairing code" }).click();
  await expect(page.getByRole("heading", { name: "Pair this device" })).toBeVisible();
  await expect(page.getByLabel("Pairing code")).toBeVisible();
});
