// The #404 parity list, one test per item that is testable on one machine: tabs belong to a space as in herdr-app. Items
// an existing spec already proves are named there instead of repeated here:
// - 3: split-tree.e2e.ts (an unlimited nested row/column tree, kept across a reload; focus moves between panes).
// - 5: tab-reorder.e2e.ts (a drag persists across a reload). Dragging a pane onto a tab is not a herdr-app move (ruling
//   C): its panes drag only within their split tab, and a drop outside another pane cancels (pane-move.e2e.ts, #408).
// - 6: close-ends-program.e2e.ts (#426's confirm rules); close-last-tab.e2e.ts (the last tab asks Close space?).
// - 7: focus-ring.e2e.ts (focus-visible rings on the strip's controls).
// - 8: space-rename.e2e.ts (a space rename shows on another device at once).
// - 9: space-rename-relay.e2e.ts (two devices over the relay); layout-sync.e2e.ts (splits on two devices at once).
// - 10: phone-header.e2e.ts (the 44 px switch button and its sheet); phone-panes.e2e.ts (a split tab on a phone).
// - 11: tabs-per-space.e2e.ts (adoption into the folder's space, else Home, once); machine-rename.e2e.ts (#495).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, devices, type Page } from "@playwright/test";
import { agentRow } from "./agents.ts";
import { E2E_HOST_PORT, E2E_TOKEN } from "./config.ts";
import { getCoreDoc } from "./core-doc.ts";
import { expect, laidOutBox, test } from "./fixtures.ts";
import { routeHcSocket } from "./hc-socket.ts";
import { LAYOUT_DOC, paneOf, seedSpaces } from "./layout-doc.ts";
import { hcOn } from "./machine-switch.ts";
import { endOwnTerminals } from "./own-terminals.ts";

test.use({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });

endOwnTerminals();

interface SavedTab {
  readonly id?: string;
  readonly name?: string;
  readonly root?: unknown;
}

function saved(): readonly { readonly id?: string; readonly name?: string; readonly tabs?: readonly SavedTab[] }[] {
  const doc = getCoreDoc(LAYOUT_DOC) as { spaces?: { id?: string; name?: string; tabs?: SavedTab[] }[] } | null;
  return doc?.spaces ?? [];
}

/** Each saved space's name and its tabs' names, in the document's order. */
const savedSpaces = () => saved().map((space) => [space.name ?? "", (space.tabs ?? []).map((tab) => tab.name ?? "")]);

/** How many panes the saved tab `id` holds. */
function panesIn(id: string): number {
  const tab = saved()
    .flatMap((space) => space.tabs ?? [])
    .find((each) => each.id === id);
  const count = (node: unknown): number => {
    if (typeof node !== "object" || node === null) return 0;
    const children = (node as { children?: unknown[] }).children;
    return Array.isArray(children) ? children.reduce<number>((sum, child) => sum + count(child), 0) : 1;
  };
  return count(tab?.root);
}

/** Whether hc still lists the terminal live. */
function live(address: string): boolean {
  const listed = JSON.parse(hcOn("host", ["ls", "--json"])) as { terminals?: { address?: string; state?: string }[] };
  return (listed.terminals ?? []).some((each) => each.address === address && each.state === "live");
}

/** A plain shell started straight on the core in `cwd`, in no tab; named, so its tab reads that name. */
function shellIn(cwd: string, name?: string): string {
  const named = name === undefined ? [] : ["--name", name];
  const out = hcOn("host", ["run", "--bg", ...named, "--cwd", cwd, "--", "env", "PS1=$ ", "sh"]);
  return String((JSON.parse(out) as { address: string }).address);
}

const tabBar = (page: Page) => page.getByRole("tablist", { name: "Tabs" }).getByRole("tab");
const tabItem = (page: Page, text: string) =>
  page.getByRole("tablist", { name: "Tabs" }).locator("[data-tab-id]").filter({ hasText: text });
const selected = (page: Page) => page.getByRole("tab", { selected: true });
const spaceRow = (page: Page, name: string) =>
  page
    .getByRole("complementary", { name: "Workspace" })
    .getByRole("region", { name: "Spaces" })
    .getByRole("button", { name: new RegExp(`^${name}\\b`) });
const focusedTerminal = (page: Page) => page.locator('[data-focused="true"] [data-terminal]');
const mac = (page: Page) => page.evaluate(() => /mac/i.test(navigator.platform));

/** The platform's chord for an action, as the default keymap binds it (keys/defaults.ts). */
async function chord(page: Page, action: "new" | "close" | "right" | "down" | "select"): Promise<string> {
  const onMac = await mac(page);
  const chords = {
    new: onMac ? "Meta+KeyT" : "Control+Shift+KeyT",
    close: onMac ? "Meta+Alt+KeyW" : "Control+Shift+KeyW",
    right: onMac ? "Meta+KeyD" : "Control+Shift+KeyO",
    down: onMac ? "Meta+Shift+KeyD" : "Control+Shift+KeyE",
    select: onMac ? "Meta" : "Control",
  };
  return chords[action];
}

interface Spaces {
  readonly alpha: string;
  readonly beta: string;
  readonly shells: Readonly<Record<"a1" | "a2" | "b1" | "b2", string>>;
}

/** Two spaces of two tabs each, every tab one shell started in its space's folder. */
function twoSpaces(): Spaces {
  const root = mkdtempSync(join(tmpdir(), "tabs-parity-"));
  const alpha = mkdtempSync(join(root, "alpha-"));
  const beta = mkdtempSync(join(root, "beta-"));
  const shells = {
    a1: shellIn(alpha, "parity-a1"),
    a2: shellIn(alpha, "parity-a2"),
    b1: shellIn(beta, "parity-b1"),
    b2: shellIn(beta, "parity-b2"),
  };
  seedSpaces([
    {
      id: "spc-alpha",
      name: "alpha",
      folder: alpha,
      tabs: [
        { id: "tb-a1", name: "a-one", terminal: shells.a1 },
        { id: "tb-a2", name: "a-two", terminal: shells.a2 },
      ],
    },
    {
      id: "spc-beta",
      name: "beta",
      folder: beta,
      tabs: [
        { id: "tb-b1", name: "b-one", terminal: shells.b1 },
        { id: "tb-b2", name: "b-two", terminal: shells.b2 },
      ],
    },
  ]);
  return { alpha, beta, shells };
}

/** A second device: its own browser context (its own storage, so its own selection) on the same host. */
async function secondDevice(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });
  const settings = {
    mode: "loopback",
    relayUrl: "wss://relay-doriface.omo.dev",
    directUrl: "",
    hostId: "",
    loopbackUrl: `ws://127.0.0.1:${E2E_HOST_PORT}/v1/hc`,
    token: E2E_TOKEN,
  };
  await context.addInitScript((value) => localStorage.setItem("doriface.connection", value), JSON.stringify(settings));
  return context.newPage();
}

test("1: the strip shows only the selected space's tabs, and a space comes back on its last tab, also after a reload", async ({
  page,
}) => {
  twoSpaces();
  await page.goto("/");
  await spaceRow(page, "alpha").click();
  await expect(tabBar(page)).toHaveText([/a-one/, /a-two/]);
  await tabBar(page).filter({ hasText: "a-two" }).click();
  await spaceRow(page, "beta").click();
  await expect(tabBar(page)).toHaveText([/b-one/, /b-two/]);
  await tabBar(page).filter({ hasText: "b-two" }).click();
  await expect(selected(page)).toHaveText(/b-two/);

  await page.reload();
  await expect(tabBar(page)).toHaveText([/b-one/, /b-two/], { timeout: 20_000 });
  await expect(selected(page)).toHaveText(/b-two/);
  await spaceRow(page, "alpha").click();
  await expect(tabBar(page)).toHaveText([/a-one/, /a-two/]);
  await expect(selected(page)).toHaveText(/a-two/);
  await spaceRow(page, "beta").click();
  await expect(selected(page)).toHaveText(/b-two/);
});

test('2: the New tab chord and "+" add a focused tab after the active one, in the space\'s folder, ready for typing', async ({
  page,
}) => {
  const { beta, shells } = twoSpaces();
  await page.goto("/");
  await spaceRow(page, "beta").click();
  await tabBar(page).filter({ hasText: "b-one" }).click();
  await paneOf(page, shells.b1).getByRole("textbox").focus();

  await page.keyboard.press(await chord(page, "new"));
  // Typed straight away: it reaches the new tab, which starts where the space is.
  await page.keyboard.type("echo at-$PWD-key");
  await page.keyboard.press("Enter");
  await expect(tabBar(page)).toHaveCount(3, { timeout: 15_000 });
  await expect(focusedTerminal(page)).toContainText(`at-${beta}-key`, { timeout: 15_000 });
  await expect(selected(page)).toHaveAttribute("aria-selected", "true");
  await expect.poll(savedSpaces, { timeout: 15_000 }).toEqual([
    ["alpha", ["a-one", "a-two"]],
    ["beta", ["b-one", "", "b-two"]],
  ]);

  await page.getByRole("button", { name: "New tab" }).click();
  await page.keyboard.type("echo at-$PWD-plus");
  await page.keyboard.press("Enter");
  await expect(tabBar(page)).toHaveCount(4, { timeout: 15_000 });
  await expect(focusedTerminal(page)).toContainText(`at-${beta}-plus`, { timeout: 15_000 });
  await expect.poll(savedSpaces, { timeout: 15_000 }).toEqual([
    ["alpha", ["a-one", "a-two"]],
    ["beta", ["b-one", "", "", "b-two"]],
  ]);
  await expect(tabBar(page).nth(2)).toHaveAttribute("aria-selected", "true");
});

test("3: the split chords split only the current tab, nested, and a tab whose last pane ends closes", async ({
  page,
}) => {
  const { shells } = twoSpaces();
  await page.goto("/");
  await spaceRow(page, "beta").click();
  await tabBar(page).filter({ hasText: "b-one" }).click();
  await paneOf(page, shells.b1).getByRole("textbox").focus();
  await page.keyboard.press(await chord(page, "right"));
  await expect.poll(() => panesIn("tb-b1"), { timeout: 15_000 }).toBe(2);
  await expect(focusedTerminal(page)).not.toHaveAttribute("data-terminal", shells.b1, { timeout: 15_000 });
  await page.keyboard.press(await chord(page, "down"));
  await expect.poll(() => panesIn("tb-b1"), { timeout: 15_000 }).toBe(3);
  await expect(tabBar(page)).toHaveText([/b-one/, /b-two/]);
  expect([panesIn("tb-a1"), panesIn("tb-a2"), panesIn("tb-b2")]).toEqual([1, 1, 1]);

  await tabBar(page).filter({ hasText: "b-two" }).click();
  await paneOf(page, shells.b2).getByRole("textbox").focus();
  await page.keyboard.type("exit");
  await page.keyboard.press("Enter");
  await expect(tabBar(page)).toHaveText([/b-one/], { timeout: 15_000 });
  await expect.poll(savedSpaces, { timeout: 15_000 }).toEqual([
    ["alpha", ["a-one", "a-two"]],
    ["beta", ["b-one"]],
  ]);
});

test("4 (A): a tab reads its name, else its number, with its program's icon; it does not follow the pane's title and has no tooltip", async ({
  page,
}) => {
  const folder = mkdtempSync(join(tmpdir(), "tabs-parity-title-"));
  const [first, second] = [shellIn(folder), shellIn(folder)];
  seedSpaces([
    {
      id: "spc-title",
      name: "titles",
      folder,
      tabs: [
        { id: "tb-t1", name: "", terminal: first },
        { id: "tb-t2", name: "named", terminal: second },
      ],
    },
  ]);
  await page.goto("/");
  await expect(tabBar(page)).toHaveText(["1", "named"], { timeout: 20_000 });
  hcOn("host", ["send", first, "printf '\\033]0;a-program-title\\007'"]);
  await expect(page.getByRole("button", { name: "Session actions for a-program-title" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(tabBar(page)).toHaveText(["1", "named"]);
  await expect(tabBar(page).and(page.locator("[title]"))).toHaveCount(0);
  await expect(page.getByRole("tablist", { name: "Tabs" }).locator("[title]")).toHaveCount(0);
  await expect(tabBar(page).first().locator("svg.lucide-terminal")).toHaveCount(1);

  // A split pane in focus does not rename the tab; the number is its place, so a move renumbers it.
  await paneOf(page, first).getByRole("textbox").focus();
  await page.keyboard.press(await chord(page, "right"));
  await expect.poll(() => panesIn("tb-t1"), { timeout: 15_000 }).toBe(2);
  await expect(tabBar(page)).toHaveText(["1", "named"]);
  await tabBar(page).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move tab right" }).click();
  await expect(tabBar(page)).toHaveText(["named", "2"], { timeout: 15_000 });
});

test("5: a tab moved in the strip keeps its place in the document, and another device shows the new order", async ({
  page,
  browser,
}) => {
  twoSpaces();
  const other = await secondDevice(browser);
  await Promise.all([page.goto("/"), other.goto("/")]);
  await spaceRow(page, "beta").click();
  await spaceRow(other, "beta").click();
  await expect(tabBar(other)).toHaveText([/b-one/, /b-two/], { timeout: 20_000 });
  await tabBar(page).filter({ hasText: "b-one" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move tab right" }).click();
  await expect(tabBar(page)).toHaveText([/b-two/, /b-one/]);
  await expect(tabBar(other)).toHaveText([/b-two/, /b-one/], { timeout: 15_000 });
  await expect.poll(savedSpaces, { timeout: 15_000 }).toEqual([
    ["alpha", ["a-one", "a-two"]],
    ["beta", ["b-two", "b-one"]],
  ]);
  await other.context().close();
});

test("6 (B, D): only the active tab has a close button; a middle-click closes nothing; a space's last tab asks Close space? and closes the space", async ({
  page,
}) => {
  const { shells } = twoSpaces();
  await page.goto("/");
  await spaceRow(page, "beta").click();
  await tabBar(page).filter({ hasText: "b-one" }).click();
  await expect(tabItem(page, "b-one").getByRole("button", { name: /^Close / })).toHaveCount(1);
  await expect(tabItem(page, "b-two").getByRole("button", { name: /^Close / })).toHaveCount(0);

  await tabItem(page, "b-two").click({ button: "middle" });
  await expect(tabBar(page)).toHaveText([/b-one/, /b-two/]);
  expect(live(shells.b2)).toBe(true);

  // Its menu closes any tab, as herdr-app's tab menu (Rename, New tab, Close).
  await tabItem(page, "b-two").click({ button: "right" });
  await expect(page.getByRole("menuitem")).toHaveText([
    /^Move tab left/,
    /^Move tab right/,
    /^Rename tab…/,
    /^New tab/,
    /^Close tab/,
  ]);
  await page.getByRole("menuitem", { name: "Close tab" }).click();
  await expect(tabBar(page)).toHaveText([/b-one/], { timeout: 15_000 });
  await expect.poll(() => live(shells.b2), { timeout: 15_000 }).toBe(false);

  // The space's last tab takes the space with it, and asks first, naming its tabs and terminals (herdr-app space.close).
  await paneOf(page, shells.b1).getByRole("textbox").focus();
  await page.keyboard.press(await chord(page, "close"));
  const ask = page.getByRole("dialog", { name: "Close space?" });
  await expect(ask).toContainText("beta \u2014 1 tab, 1 terminal");
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(ask).toBeHidden();
  expect(live(shells.b1)).toBe(true);
  await page.getByRole("button", { name: "Close b-one" }).click();
  await page.getByRole("dialog", { name: "Close space?" }).getByRole("button", { name: "Close" }).click();
  await expect(spaceRow(page, "beta")).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(savedSpaces, { timeout: 15_000 }).toEqual([["alpha", ["a-one", "a-two"]]]);
  await expect.poll(() => live(shells.b1), { timeout: 15_000 }).toBe(false);
  // herdr-app's remove_space: the space that takes its place, else the last, is shown.
  await expect(tabBar(page)).toHaveText([/a-one/, /a-two/]);

  await page.getByRole("button", { name: "Close a-one" }).click();
  await expect(tabBar(page)).toHaveText([/a-two/], { timeout: 15_000 });
  await page.getByRole("button", { name: "Close a-two" }).click();
  await page.getByRole("dialog", { name: "Close space?" }).getByRole("button", { name: "Close" }).click();
  await expect(tabBar(page)).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "New terminal" })).toBeVisible();
});

test("7: Ctrl+Tab, Ctrl+Shift+Tab and the number chords move within the selected space only", async ({ page }) => {
  const { shells } = twoSpaces();
  await page.goto("/");
  await spaceRow(page, "beta").click();
  await tabBar(page).filter({ hasText: "b-one" }).click();
  await expect(page.getByRole("tablist", { name: "Tabs" })).toBeVisible();
  await paneOf(page, shells.b1).getByRole("textbox").focus();

  await page.keyboard.press("Control+Tab");
  await expect(selected(page)).toHaveText(/b-two/);
  await page.keyboard.press("Control+Tab");
  await expect(selected(page)).toHaveText(/b-one/);
  await page.keyboard.press("Control+Shift+Tab");
  await expect(selected(page)).toHaveText(/b-two/);
  const select = await chord(page, "select");
  await page.keyboard.press(`${select}+1`);
  await expect(selected(page)).toHaveText(/b-one/);
  await page.keyboard.press(`${select}+2`);
  await expect(selected(page)).toHaveText(/b-two/);
  await page.keyboard.press(`${select}+3`);
  await expect(selected(page)).toHaveText(/b-two/);
  await expect(tabBar(page)).toHaveText([/b-one/, /b-two/]);
  await expect(tabBar(page).filter({ hasText: "b-one" })).toHaveAttribute("aria-selected", "false");
});

test("8 (E): a tab renamed by a double-click, F2 or its menu shows the name on every device; Shift+F2 renames the space", async ({
  page,
  browser,
}) => {
  const { shells } = twoSpaces();
  const other = await secondDevice(browser);
  await Promise.all([page.goto("/"), other.goto("/")]);
  await spaceRow(page, "alpha").click();
  await spaceRow(other, "alpha").click();
  await expect(tabBar(other)).toHaveText([/a-one/, /a-two/], { timeout: 20_000 });

  await tabBar(page).filter({ hasText: "a-one" }).dblclick();
  const dialog = page.getByRole("dialog", { name: "Rename a-one" });
  await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue("a-one");
  await dialog.getByRole("textbox", { name: "Name" }).fill("fix login");
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect(dialog).toBeHidden();
  await expect(tabBar(page)).toHaveText([/fix login/, /a-two/]);
  await expect(tabBar(other)).toHaveText([/fix login/, /a-two/], { timeout: 15_000 });

  // F2 from the terminal renames the tab in view, as herdr-app's keys.
  await tabBar(page).filter({ hasText: "a-two" }).click();
  await paneOf(page, shells.a2).getByRole("textbox").focus();
  await page.keyboard.press("F2");
  const byKey = page.getByRole("dialog", { name: "Rename a-two" });
  await byKey.getByRole("textbox", { name: "Name" }).fill("review");
  await page.keyboard.press("Enter");
  await expect(tabBar(page)).toHaveText([/fix login/, /review/]);
  await expect(tabBar(other)).toHaveText([/fix login/, /review/], { timeout: 15_000 });
  await expect.poll(savedSpaces).toEqual([
    ["alpha", ["fix login", "review"]],
    ["beta", ["b-one", "b-two"]],
  ]);

  // An empty name gives the tab its number back.
  await tabBar(page).filter({ hasText: "fix login" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename tab…" }).click();
  const again = page.getByRole("dialog", { name: "Rename fix login" });
  await again.getByRole("textbox", { name: "Name" }).fill("");
  await again.getByRole("button", { name: "Rename" }).click();
  await expect(tabBar(page)).toHaveText(["1", /review/], { timeout: 15_000 });
  await expect(tabBar(other)).toHaveText(["1", /review/], { timeout: 15_000 });

  await paneOf(page, shells.a2).getByRole("textbox").focus();
  await page.keyboard.press("Shift+F2");
  await expect(page.getByRole("dialog", { name: "Rename alpha" })).toBeVisible();
  await page.keyboard.press("Escape");
  await other.context().close();
});

test("E: the ninth number chord selects the ninth tab, not the last", async ({ page }) => {
  const folder = mkdtempSync(join(tmpdir(), "tabs-parity-nine-"));
  const shells = Array.from({ length: 11 }, () => shellIn(folder));
  seedSpaces([
    {
      id: "spc-nine",
      name: "nine",
      folder,
      tabs: shells.map((terminal, index) => ({ id: `tb-n${index}`, name: `n${index + 1}`, terminal })),
    },
  ]);
  await page.goto("/");
  await expect(tabBar(page)).toHaveCount(11, { timeout: 20_000 });
  await tabBar(page).first().click();
  await paneOf(page, shells[0] ?? "")
    .getByRole("textbox")
    .focus();
  await page.keyboard.press(`${await chord(page, "select")}+9`);
  await expect(selected(page)).toHaveText("n9");
  await page.keyboard.press(`${await chord(page, "select")}+1`);
  await expect(selected(page)).toHaveText("n1");
});

test("9: a device that was offline converges on the order and names another device changed meanwhile", async ({
  page,
  browser,
}) => {
  twoSpaces();
  const other = await secondDevice(browser);
  const link = await routeHcSocket(other);
  await Promise.all([page.goto("/"), other.goto("/")]);
  await spaceRow(page, "beta").click();
  await spaceRow(other, "beta").click();
  await expect(tabBar(other)).toHaveText([/b-one/, /b-two/], { timeout: 20_000 });

  await link.drop(true);
  await expect(other.getByRole("status").filter({ hasText: "Reconnecting" })).toBeVisible({ timeout: 15_000 });
  await tabBar(page).filter({ hasText: "b-one" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move tab right" }).click();
  await tabBar(page).filter({ hasText: "b-one" }).dblclick();
  const dialog = page.getByRole("dialog", { name: "Rename b-one" });
  await dialog.getByRole("textbox", { name: "Name" }).fill("while away");
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect(tabBar(page)).toHaveText([/b-two/, /while away/]);
  await expect(tabBar(other)).toHaveText([/b-one/, /b-two/]);

  link.restore();
  await expect(tabBar(other)).toHaveText([/b-two/, /while away/], { timeout: 20_000 });
  await other.context().close();
});

test.describe("10: on a phone at 390", () => {
  const { defaultBrowserType: _browser, ...phone } = devices["iPhone 14"];
  test.use({ ...phone });

  test("the switch sheet lists each space's tabs from the same model, with 44 px targets, and opens the tab picked", async ({
    page,
  }) => {
    twoSpaces();
    await page.goto("/");
    expect(page.viewportSize()?.width).toBe(390);
    await agentRow(page, "parity-b1", false).click();
    const header = page.getByRole("banner");
    await expect(header.getByRole("heading", { name: "parity-b1" })).toBeVisible({ timeout: 15_000 });
    await expect(header.getByText("1/2", { exact: true })).toBeVisible();
    const switcher = header.getByRole("button", { name: "Switch space or tab" });
    const box = await laidOutBox(switcher);
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    // Thumb-reachable: the switch sits in the header row, not behind a menu.
    expect(box.y + box.height).toBeLessThanOrEqual(120);

    await switcher.click();
    const sheet = page.getByRole("dialog", { name: "Spaces" });
    await expect(sheet).toBeVisible();
    const rows = [
      ["alpha", "parity-a1"],
      ["alpha", "parity-a2"],
      ["beta", "parity-b1"],
      ["beta", "parity-b2"],
    ] as const;
    const heights = await Promise.all(
      rows.map(
        async ([space, row]) =>
          (await laidOutBox(agentRow(sheet.getByRole("region", { name: space }), row, false))).height,
      ),
    );
    for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
    await agentRow(sheet.getByRole("region", { name: "beta" }), "parity-b2", false).click();
    await expect(sheet).toBeHidden();
    await expect(header.getByRole("heading", { name: "parity-b2" })).toBeVisible({ timeout: 15_000 });
    await expect(header.getByText("2/2", { exact: true })).toBeVisible();
  });

  test("a split tab is one tab: the header counts 2/3 for 3 tabs and the sheet lists each tab once", async ({
    page,
  }) => {
    const folder = mkdtempSync(join(tmpdir(), "tabs-parity-split-"));
    const [one, two, twoBeside, three] = [
      shellIn(folder, "split-w1"),
      shellIn(folder, "split-w2"),
      shellIn(folder, "split-w2b"),
      shellIn(folder, "split-w3"),
    ];
    seedSpaces([
      {
        id: "spc-web",
        name: "web",
        folder,
        tabs: [
          { id: "tb-w1", name: "", terminal: one },
          { id: "tb-w2", name: "", terminal: two, beside: [twoBeside] },
          { id: "tb-w3", name: "", terminal: three },
        ],
      },
    ]);
    await page.goto("/");
    await agentRow(page, "split-w2", false).click();
    const header = page.getByRole("banner");
    await expect(header.getByRole("heading", { name: "split-w2" })).toBeVisible({ timeout: 15_000 });
    await expect(header.getByText("2/3", { exact: true })).toBeVisible();
    await expect(header.getByText("Tab 2 of 3")).toHaveCount(1);
    const panes = page.getByRole("navigation", { name: "Panes in this tab" });
    await panes.getByRole("button", { name: "Next pane" }).click();
    await expect(header.getByRole("heading", { name: "split-w2b" })).toBeVisible({ timeout: 15_000 });
    await expect(header.getByText("2/3", { exact: true })).toBeVisible();

    await header.getByRole("button", { name: "Switch space or tab" }).click();
    const web = page.getByRole("dialog", { name: "Spaces" }).getByRole("region", { name: "web" });
    // One row per tab; the split tab shows the pane in view.
    await expect(agentRow(web, "split-w1", false)).toHaveCount(1);
    await expect(agentRow(web, "split-w2b", false)).toHaveCount(1);
    await expect(agentRow(web, "split-w3", false)).toHaveCount(1);
    await expect(agentRow(web, "split-w2", false)).toHaveCount(0);
    await expect(web.getByRole("button")).toHaveCount(3);
  });
});
