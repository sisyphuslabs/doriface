// #545: while the host cannot be reached, the connection notice says so once; the sidebar shows no raw error of its own
// beside it, and is back to normal when the host answers again.
import { expect, openNewTerminal, test } from "./fixtures.ts";
import { routeHcSocket } from "./hc-socket.ts";

test.use({ serviceWorkers: "block" });

test("a host that cannot be reached leaves the sidebar without a raw error beside the connection notice", async ({
  page,
}) => {
  const link = await routeHcSocket(page);
  await page.goto("/");
  await openNewTerminal(page);
  const spaces = page.getByRole("region", { name: "Spaces" });
  await expect(spaces).toBeVisible();

  await link.drop(true);
  await expect(page.getByRole("contentinfo").getByText(/Reconnecting/)).toBeVisible({ timeout: 20_000 });
  // The sidebar reads the machines again when the page is shown; that read meets the closed link.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("contentinfo").getByText(/Reconnecting/)).toBeVisible();
  // The sidebar keeps its spaces and says nothing that competes with the notice, least of all the raw cause.
  await expect(page.getByText("connection is closed")).toHaveCount(0);
  await expect(spaces.getByText("Could not list the machines")).toHaveCount(0);

  link.restore();
  await expect(page.getByRole("contentinfo").getByText(/Reconnecting/)).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText("Could not list the machines")).toHaveCount(0);
});
