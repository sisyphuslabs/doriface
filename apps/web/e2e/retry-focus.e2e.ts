// A terminal that starts again after its attach failed (Try again) is starting: in a pane that is not the focused one it
// hands the keyboard back, as on its first start (#163).
import { endAgent, startShell } from "./agents.ts";
import { expect, test } from "./fixtures.ts";
import { routeHcSocket } from "./hc-socket.ts";
import { paneOf, seedLayout } from "./layout-doc.ts";

const shells: string[] = [];
test.afterEach(() => {
  for (const shell of shells.splice(0)) endAgent("host", shell);
});

test("a pane retried after its attach failed does not take the keyboard from the focused pane", async ({ page }) => {
  const left = startShell("host", "keeps-keys");
  shells.push(left);
  seedLayout([{ id: "tb-retry", root: [{ pane: "p-left", terminal: left }] }]);
  const socket = await routeHcSocket(page);
  await page.goto("/");
  const leftInput = paneOf(page, left).locator(`[data-terminal="${left}"] textarea`);
  await expect(paneOf(page, left)).toContainText("$", { timeout: 20_000 });
  await expect(leftInput).toBeFocused();

  // A split starts a new terminal in a new pane; its attach fails while the person is back in the left pane, so the new
  // pane shows the didn't-open screen without being the focused one.
  const failAttach = socket.hold("terminal.attach");
  await page.getByRole("button", { name: "Split right" }).first().click();
  await expect
    .poll(() => socket.sent().some((frame) => frame.includes('"method":"terminal.attach"')), { timeout: 20_000 })
    .toBe(true);
  const others = page.locator(`[data-terminal]:not([data-terminal="${left}"])`);
  await expect(others).toHaveCount(1, { timeout: 20_000 });
  const right = (await others.getAttribute("data-terminal")) ?? "";
  shells.push(right);
  await paneOf(page, left).locator(`[data-terminal="${left}"]`).click();
  await expect(leftInput).toBeFocused();
  failAttach(true);
  const retried = page.locator("section", { has: page.getByRole("heading", { name: "This terminal didn't open" }) });
  await expect(retried).toBeVisible({ timeout: 20_000 });
  await expect(leftInput).toBeFocused();

  // Try again without the press moving the focus, as a click does in Safari: the terminal starts again in that pane.
  await retried.getByRole("button", { name: "Try again" }).dispatchEvent("click");
  await expect(paneOf(page, right)).toContainText("$", { timeout: 20_000 });
  await expect(paneOf(page, right).locator(`[data-terminal="${right}"]`)).toHaveAttribute("data-ready", "true");
  await expect(leftInput).toBeFocused();
  await page.keyboard.type("echo kept-$((40+2))\r");
  await expect(paneOf(page, left)).toContainText("kept-42", { timeout: 15_000 });
});
