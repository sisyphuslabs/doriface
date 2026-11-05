import { expect, openNewTerminal, test } from "./fixtures.ts";
import { routeHcSocket } from "./hc-socket.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

test("while the saved layout loads, the desktop says so instead of 'No terminal open' (#482)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const socket = await routeHcSocket(page);
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  const address = (await terminal.getAttribute("data-terminal")) ?? "";

  const release = socket.hold("doc.get", "machine.list");
  await page.reload();
  // The core has listed its terminals (the status bar counts the open one) while the layout is still unanswered.
  await expect(page.getByText(/^1 terminal$/)).toBeVisible();
  await expect(page.getByRole("status", { name: "Restoring your tabs" })).toBeVisible();
  await expect(page.getByText("No terminal open")).toHaveCount(0);

  release();
  await expect(page.locator(`[data-terminal="${address}"]`)).toBeVisible();
  await expect(page.getByRole("status", { name: "Restoring your tabs" })).toHaveCount(0);
  await expect(page.getByText("No terminal open")).toHaveCount(0);
});

test("a terminal waiting on its attach says it is opening, and the pane is busy until it attaches (#483)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const socket = await routeHcSocket(page);
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  const address = (await terminal.getAttribute("data-terminal")) ?? "";

  const release = socket.hold("terminal.attach");
  await page.reload();
  const pane = page.locator(`[data-terminal="${address}"]`);
  await expect(pane).toBeVisible();
  const opening = page.getByRole("status", { name: "Opening terminal" });
  await expect(opening).toBeVisible();
  await expect(pane.locator("xpath=..")).toHaveAttribute("aria-busy", "true");
  const before = await pane.boundingBox();

  release();
  await expect(opening).toHaveCount(0);
  await expect(pane.locator("xpath=..")).not.toHaveAttribute("aria-busy", "true");
  await expect(pane).toContainText("$");
  // The opening state sat over the grid: the terminal kept its size when it went away.
  expect(await pane.boundingBox()).toEqual(before);
});
