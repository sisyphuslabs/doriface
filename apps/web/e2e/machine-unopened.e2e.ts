// Opening a session whose machine dropped before the page heard: the attach fails, and the pane says why in plain
// words with Try again, instead of hc's error text.
import { agentRow, endAgent, startShell } from "./agents.ts";
import { expect, test } from "./fixtures.ts";
import { routeHcSocket } from "./hc-socket.ts";
import { MACHINE_NAME } from "./machine.ts";
import { hcOn, reconnect, switchTo } from "./machine-switch.ts";

// A local shell is the first live terminal, so it is the tab that opens on load; the remote one attaches only when
// it is opened after the drop.
let local = "";
let remote = "";
test.beforeEach(() => {
  local = startShell("host", "home");
  remote = startShell("machine", "fin");
});
test.afterEach(() => {
  reconnect();
  endAgent("machine", remote);
  endAgent("host", local);
});

test("a session on a machine that just dropped shows the didn't-open screen, and Try again attaches", async ({
  page,
}) => {
  const socket = await routeHcSocket(page);
  await page.goto("/");
  await expect(agentRow(page, "fin", true)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(`[role="tabpanel"]:not([hidden]) [data-terminal="${MACHINE_NAME}/${remote}"]`)).toHaveCount(
    0,
  );
  // The page keeps its last machine.list (connected), so the pane tries to attach instead of showing the machine offline.
  const release = socket.hold("machine.list");
  switchTo("drop");
  await expect.poll(() => hcOn("host", ["machine", "ls"]), { timeout: 25_000 }).toContain("unreachable");
  await agentRow(page, "fin", true).click();

  const pane = page.locator('[data-focused="true"]');
  await expect(pane.getByRole("heading", { name: "This terminal didn't open" })).toBeVisible({ timeout: 20_000 });
  await expect(pane).toContainText(`${MACHINE_NAME} can't be reached right now, so this terminal can't open.`);
  expect(await pane.innerText()).not.toMatch(/HcRpcError|Could not open|sh -c|\[object/);

  reconnect();
  release();
  await expect.poll(() => hcOn("host", ["machine", "ls"]), { timeout: 25_000 }).not.toContain("unreachable");
  await pane.getByRole("button", { name: "Try again" }).click();
  const terminal = pane.locator(`[data-terminal="${MACHINE_NAME}/${remote}"]`);
  await expect(terminal).toContainText("$", { timeout: 15_000 });
  await terminal.click();
  await page.keyboard.type("echo again-$((40+2))\r");
  await expect(terminal).toContainText("again-42", { timeout: 15_000 });
});
