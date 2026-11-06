import { devices, type Page } from "@playwright/test";
import { agentRow, endAgent } from "./agents.ts";
import { expect, laidOutBox, opened, test } from "./fixtures.ts";
import { seedSpaces } from "./layout-doc.ts";
import { hcOn } from "./machine-switch.ts";

const { defaultBrowserType: _browser, ...phone } = devices["iPhone 14"];
// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ ...phone, serviceWorkers: "block" });

const header = (page: Page) => page.getByRole("banner");
const counts = (page: Page) => header(page).locator("[data-agent-counts]");

/** What a screen reader reads for the counts: every state as a number and its word. */
const COUNTS = /^(\d+) done, (\d+) working, (\d+) idle$/;

interface Counts {
  readonly done: number;
  readonly working: number;
  readonly idle: number;
}

const said = ({ done, working, idle }: Counts): string => `${done} done, ${working} working, ${idle} idle`;

async function readCounts(page: Page): Promise<Counts> {
  await expect(counts(page)).toHaveText(COUNTS, { timeout: 15_000 });
  const match = COUNTS.exec((await counts(page).textContent()) ?? "");
  if (match === null) throw new Error("the header counts read no numbers");
  return { done: Number(match[1]), working: Number(match[2]), idle: Number(match[3]) };
}

/** A plain shell in a space of its own, started straight on the e2e core; it reports a state only when told to. */
function startShellIn(space: string, name: string): string {
  const out = hcOn("host", ["run", "--bg", "--name", name, "--label", `space=${space}`, "--", "env", "PS1=$ ", "sh"]);
  const started: unknown = JSON.parse(out);
  if (typeof started !== "object" || started === null || !("address" in started)) throw new Error(out);
  return String(started.address);
}

/** Types into the shell a command that reports `state` over OSC 7501, as an agent does when its turn changes. */
function report(address: string, state: string): void {
  hcOn("host", ["send", address, `printf '\\033]7501;state=${state}\\033\\\\'`]);
}

test("on a phone the terminal header says where you are, follows hc's agent states live, and switches tabs", async ({
  page,
}) => {
  const run = Date.now().toString(36);
  const space = `hdr-${run}`;
  const first = `hdr-a-${run}`;
  const second = `hdr-b-${run}`;
  const started = [startShellIn(space, first), startShellIn(space, second)];
  // The space as the layout saves it (#404): one tab per shell, in this order.
  const saveSpace = (): void =>
    seedSpaces([
      {
        id: "spc-hdr",
        name: space,
        folder: "",
        tabs: started.map((terminal, index) => ({ id: `tb-hdr-${index}`, name: "", terminal })),
      },
    ]);
  try {
    saveSpace();
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible({ timeout: 20_000 });
    await agentRow(page, first, false).click();
    // The heading reads the tab as the desktop strip does: these tabs have no name, so their number (#466 ruling A).
    await expect(header(page).getByRole("heading", { name: "1", exact: true })).toBeVisible({ timeout: 15_000 });

    // Where: the space, and this tab's place among the space's tabs.
    await expect(header(page).getByText(space, { exact: true })).toBeVisible();
    // The tab's place is the bottom tabs bar's, not the header's (#466).
    await expect(page.locator("[data-phone-tabs]").getByRole("button", { name: /^Switch tab, / })).toContainText("1/2");
    await expect(page.locator("[data-phone-tabs]").getByRole("button", { name: /^Switch tab, / })).toHaveAccessibleName(
      /tab 1 of 2$/,
    );

    // The counts move as hc reports each agent's state, without a reload. The agent is the one in the other tab: herdr-app's
    // done is "finished while you weren't looking", so an agent this phone is showing goes back to idle (#611).
    const before = await readCounts(page);
    const beyond = started[1];
    if (beyond === undefined) throw new Error("no second terminal started");
    report(beyond, "working");
    await expect(counts(page)).toHaveText(said({ ...before, working: before.working + 1, idle: before.idle - 1 }), {
      timeout: 15_000,
    });
    report(beyond, "done");
    await expect(counts(page)).toHaveText(said({ ...before, done: before.done + 1, idle: before.idle - 1 }), {
      timeout: 15_000,
    });

    // The bottom tabs bar's switch opens the spaces and their tabs (the header has none: one strip, #466); picking another
    // tab opens it and moves the position.
    await expect(header(page).getByRole("button", { name: "Switch space or tab" })).toHaveCount(0);
    const switcher = page.locator("[data-phone-tabs]").getByRole("button", { name: /^Switch tab, / });
    const box = await laidOutBox(switcher);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await switcher.click();
    const sheet = page.getByRole("dialog", { name: "Spaces" });
    await opened(sheet);
    // A visible Done closes the sheet and hands focus back to the switch.
    // Exact: an agent row's name also carries its state, "Done" among them.
    const done = sheet.getByRole("button", { name: "Done", exact: true });
    const doneBox = await laidOutBox(done);
    expect(doneBox.width).toBeGreaterThanOrEqual(44);
    expect(doneBox.height).toBeGreaterThanOrEqual(44);
    await done.click();
    await expect(sheet).toBeHidden();
    await expect(switcher).toBeFocused();
    await switcher.click();
    await expect(sheet).toBeVisible();
    const section = sheet.getByRole("region", { name: space });
    // The rows read the tabs as the strip does: these tabs have no name, so their number (#466 ruling A).
    const tabRow = (title: string) =>
      section.getByRole("button").filter({ has: page.locator(`[data-floor="name"][title="${title}"]`) });
    await expect(tabRow("1")).toHaveAttribute("aria-current", "true");
    await tabRow("2").click();
    await expect(sheet).toBeHidden();
    await expect(header(page).getByRole("heading", { name: "2", exact: true })).toBeVisible({ timeout: 15_000 });
    // Reaching the tab that agent finished in is looking at it: it asks for nobody, so the counts read as before it did.
    await expect(counts(page)).toHaveText(said(before), { timeout: 15_000 });
    await expect(page.locator("[data-phone-tabs]").getByRole("button", { name: /^Switch tab, / })).toContainText("2/2");

    // A new tab in the same space, saved by another device, is counted at once.
    started.push(startShellIn(space, `hdr-c-${run}`));
    saveSpace();
    await expect(page.locator("[data-phone-tabs]").getByRole("button", { name: /^Switch tab, / })).toContainText(
      "2/3",
      { timeout: 15_000 },
    );
  } finally {
    for (const address of started) endAgent("host", address);
  }
});
