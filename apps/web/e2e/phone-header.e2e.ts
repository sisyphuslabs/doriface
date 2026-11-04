import { devices, type Locator, type Page } from "@playwright/test";
import { agentRow, endAgent } from "./agents.ts";
import { expect, laidOutBox, test } from "./fixtures.ts";
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

/**
 * Resolves once the sheet has finished opening: Base UI drops `data-starting-style` as the slide-in starts, and every
 * animation on the panel has then ended, so a measure inside it reads the panel at rest, not mid-slide.
 */
async function opened(sheet: Locator): Promise<void> {
  await expect(sheet).toBeVisible();
  await expect(sheet).not.toHaveAttribute("data-starting-style");
  await sheet.evaluate(async (el) => {
    await Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished));
  });
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
  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible({ timeout: 20_000 });
    await agentRow(page, first, false).click();
    await expect(header(page).getByRole("heading", { name: first })).toBeVisible({ timeout: 15_000 });

    // Where: the space, and this tab's place among the space's tabs.
    await expect(header(page).getByText(space, { exact: true })).toBeVisible();
    await expect(header(page).getByText("1/2", { exact: true })).toBeVisible();
    await expect(header(page).getByText("Tab 1 of 2", { exact: true })).toBeAttached();

    // The counts move as hc reports each agent's state, without a reload.
    const before = await readCounts(page);
    const [address] = started;
    if (address === undefined) throw new Error("no terminal started");
    report(address, "working");
    await expect(counts(page)).toHaveText(said({ ...before, working: before.working + 1, idle: before.idle - 1 }), {
      timeout: 15_000,
    });
    report(address, "done");
    await expect(counts(page)).toHaveText(said({ ...before, done: before.done + 1, idle: before.idle - 1 }), {
      timeout: 15_000,
    });

    // The switch button opens the spaces and their tabs; picking another tab opens it and moves the position.
    const switcher = header(page).getByRole("button", { name: "Switch space or tab" });
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
    await expect(agentRow(section, first, false)).toHaveAttribute("aria-current", "true");
    await agentRow(section, second, false).click();
    await expect(sheet).toBeHidden();
    await expect(header(page).getByRole("heading", { name: second })).toBeVisible({ timeout: 15_000 });
    await expect(header(page).getByText("2/2", { exact: true })).toBeVisible();

    // A new tab in the same space is counted at once.
    started.push(startShellIn(space, `hdr-c-${run}`));
    await expect(header(page).getByText("2/3", { exact: true })).toBeVisible({ timeout: 15_000 });
  } finally {
    for (const address of started) endAgent("host", address);
  }
});
