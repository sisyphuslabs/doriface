import { writeFileSync } from "node:fs";
import { expect, openNewTerminal, test } from "./fixtures.ts";
import { MACHINE_NAME } from "./machine.ts";
import { hcOn, machineRow, newOn, reconnect, STATE_BOUND_MS, switchTo } from "./machine-switch.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

/** hc's answer to `get` for a terminal on one core: "live", "finished", or "gone" once it is removed. */
function stateOn(core: "host" | "machine", address: string): string {
  try {
    const got: unknown = JSON.parse(hcOn(core, ["get", address, "--json"]));
    const state = typeof got === "object" && got !== null ? Reflect.get(got, "state") : undefined;
    return typeof state === "string" ? state : "unknown";
  } catch {
    return "gone";
  }
}

/** Ends the program (the file it waits for) and removes the terminal, so no later spec counts it. */
function removeTerminal(core: "host" | "machine", address: string, go: string): void {
  writeFileSync(go, "");
  if (stateOn(core, address) === "gone") return;
  if (stateOn(core, address) === "live") hcOn(core, ["kill", address]);
  hcOn(core, ["rm", address]);
}

// A program that ends only once the test creates `go`, so it ends while its view is not mounted.
const waitFor = (go: string) => `echo armed-$((3*3)); until [ -e '${go}' ]; do sleep 0.1; done; exit`;

test("a terminal whose program ends while the page is closed shows as ended after a reload, and closes from there", async ({
  page,
}) => {
  const go = test.info().outputPath("go");
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  const address = (await terminal.getAttribute("data-terminal")) ?? "";
  try {
    const tabs = page.getByRole("tablist", { name: "Tabs" }).getByRole("tab");
    const tabsBefore = await tabs.count();
    await terminal.getByRole("textbox").focus();
    await page.keyboard.type(waitFor(go));
    await page.keyboard.press("Enter");
    await expect(terminal).toContainText("armed-9", { timeout: 15_000 });

    // The page goes away; its tabs stay saved, and the program ends meanwhile.
    await page.goto("about:blank");
    writeFileSync(go, "");
    await expect.poll(() => stateOn("host", address), { timeout: 15_000 }).toBe("finished");
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "This session ended" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("This terminal didn't open")).toHaveCount(0);
    await expect(tabs).toHaveCount(tabsBefore);
    await page.getByRole("button", { name: "Close tab" }).click();
    await expect(tabs).toHaveCount(tabsBefore - 1, { timeout: 15_000 });
    await expect(page.getByText("This session ended")).toHaveCount(0);
  } finally {
    removeTerminal("host", address, go);
  }
});

test("a terminal on an added machine whose program ends while the machine is offline shows as ended once it is back", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const go = test.info().outputPath("go");
  await page.goto("/");
  await expect(machineRow(page)).toContainText("connected", { timeout: 20_000 });
  await newOn(page).click({ force: true });
  const focused = page.locator('[data-focused="true"] [data-terminal]');
  await expect(focused).toHaveAttribute("data-terminal", new RegExp(`^${MACHINE_NAME}/t[0-9a-z]+$`), {
    timeout: 15_000,
  });
  const address = (await focused.getAttribute("data-terminal")) ?? "";
  // The machine's own core names it without the machine prefix.
  const local = address.slice(MACHINE_NAME.length + 1);
  try {
    const terminal = page.locator(`[data-terminal="${address}"]`);
    await expect(terminal).toContainText("$", { timeout: 15_000 });
    const tabs = page.getByRole("tablist", { name: "Tabs" }).getByRole("tab");
    const tabsBefore = await tabs.count();
    await terminal.click();
    await page.keyboard.type(waitFor(go));
    await page.keyboard.press("Enter");
    await expect(terminal).toContainText("armed-9", { timeout: 15_000 });

    // The line to the machine drops; its core and the program keep running, and the pane shows the machine offline.
    switchTo("drop");
    await expect(terminal).toHaveCount(0, { timeout: STATE_BOUND_MS });
    writeFileSync(go, "");
    await expect.poll(() => stateOn("machine", local), { timeout: 15_000 }).toBe("finished");
    reconnect();
    await expect(machineRow(page)).toContainText("connected", { timeout: STATE_BOUND_MS });

    await expect(page.getByRole("heading", { name: "This session ended" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("This terminal didn't open")).toHaveCount(0);
    await expect(tabs).toHaveCount(tabsBefore);
    await page.getByRole("button", { name: "Close tab" }).click();
    await expect(tabs).toHaveCount(tabsBefore - 1, { timeout: 15_000 });
  } finally {
    reconnect();
    removeTerminal("machine", local, go);
  }
});
