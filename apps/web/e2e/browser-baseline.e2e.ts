import { expect, test } from "./fixtures.ts";

test.describe("a browser older than the baseline", () => {
  test.beforeEach(async ({ page }) => {
    // Chrome 113 and Safari 17.3 ship without it: the app's own code needs it from Chrome 119 / Safari 17.4 on (#556).
    await page.addInitScript(() => Reflect.deleteProperty(Promise, "withResolvers"));
  });

  test("says to update the browser, names what is missing, and never connects", async ({ page }) => {
    const sockets: string[] = [];
    page.on("websocket", (socket) => sockets.push(socket.url()));
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Update your browser" })).toBeVisible();
    await expect(page.getByText("Promise.withResolvers")).toBeVisible();
    await expect(page.getByText(/Chrome or Edge 119/)).toBeVisible();
    await expect(page.getByText("Cannot reach your host")).toHaveCount(0);
    expect(sockets).toEqual([]);
  });
});

test("a current browser gets the app, not the update screen", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-titlebar]").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Update your browser" })).toHaveCount(0);
});
