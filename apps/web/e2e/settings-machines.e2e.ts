import { expect, test } from "./fixtures.ts";
import { MACHINE_NAME } from "./machine.ts";
import { reconnect, STATE_BOUND_MS, switchTo } from "./machine-switch.ts";

test.describe("Settings, Machines", () => {
  test("lists this machine and the added one with their state, and says when and why one went offline", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Machines" }).click();
    await expect(page.getByRole("heading", { name: "Machines", level: 2 })).toBeVisible();
    const list = page.getByRole("list", { name: "Machines" });
    await expect(list.getByRole("listitem").filter({ hasText: "studio" })).toContainText("This machine", {
      timeout: 15_000,
    });
    const added = list.getByRole("listitem").filter({ hasText: MACHINE_NAME });
    await expect(added).toContainText("Connected", { timeout: STATE_BOUND_MS });
    await expect(page.getByText("hc machine add")).toBeVisible();
    try {
      switchTo("drop");
      await expect(added).toContainText("Offline", { timeout: STATE_BOUND_MS });
      await expect(added).toContainText(/Last seen (just now|\d+m ago)/);
      await expect(added).toContainText("isn't answering");
      await expect(added).not.toContainText(/cannot reach|sh -c/);
    } finally {
      reconnect();
    }
    await expect(added).toContainText("Connected", { timeout: STATE_BOUND_MS });
  });
});
