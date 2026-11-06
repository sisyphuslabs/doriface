// Closing a space (#612): the question its "..." menu opens, naming the space and its tabs.
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type Page } from "@playwright/test";
import { endAgent } from "./agents.ts";
import type { Shot } from "./capture-shots.ts";
import { setCoreDoc } from "./core-doc.ts";
import { expect } from "./fixtures.ts";
import { LAYOUT_DOC, treeNode } from "./layout-doc.ts";
import { hcOn } from "./machine-switch.ts";

/** The space the shot asks about, and the shells that make it what the question names: two tabs, two terminals. */
const SPACE = "website";
const started: string[] = [];
/** A directory with no git in it, so the captured row carries no branch or commit counts of this checkout. */
const DIR = join(tmpdir(), `doriface-space-close-${process.pid}`);

/** A plain shell in space `space` on the e2e core. */
function startIn(space: string, name: string): string {
  mkdirSync(DIR, { recursive: true });
  const out = hcOn("host", [
    "run",
    "--bg",
    "--name",
    name,
    "--cwd",
    DIR,
    "--label",
    `space=${space}`,
    "--",
    "env",
    "PS1=$ ",
    "sh",
  ]);
  const parsed: unknown = JSON.parse(out);
  if (typeof parsed !== "object" || parsed === null || !("address" in parsed)) throw new Error(out);
  const address = String(parsed.address);
  started.push(address);
  return address;
}

/** A tab of one pane showing `terminal`, as the layout document holds it. */
const layoutTab = (id: string, terminal: string) => ({
  id,
  name: "",
  root: { children: [treeNode({ pane: `p-${id}`, terminal })], id, type: "row" },
});

/** The space's row in the sidebar, and the question its "..." menu opens. */
const spaceRow = (page: Page, name: string) =>
  page.getByRole("complementary", { name: "Workspace" }).getByRole("button", { name: new RegExp(`^${name}\\b`) });

/**
 * The question for a space of two tabs: its two shells, and the document that holds them written before the page reads
 * it, so the counts the question names do not depend on when the page adopts anything. The row is focused rather than
 * hovered, since the actions only appear on hover or keyboard focus and a phone-width frame has no hover.
 */
async function askSpaceClose(page: Page): Promise<void> {
  const [one, two] = [startIn(SPACE, "site-one"), startIn(SPACE, "site-two")];
  setCoreDoc(LAYOUT_DOC, {
    spaces: [
      { folder: "", id: "spc-close", name: SPACE, tabs: [layoutTab("tb-close-1", one), layoutTab("tb-close-2", two)] },
    ],
  });
  await page.goto("/");
  await expect(spaceRow(page, SPACE)).toBeVisible({ timeout: 60_000 });
  await spaceRow(page, SPACE).focus();
  await page.getByRole("button", { name: `More for ${SPACE}` }).click();
  await page.getByRole("menuitem", { name: "Close space\u2026" }).click();
  await expect(page.getByRole("dialog", { name: "Close space?" })).toContainText(`${SPACE} \u2014 2 tabs, 2 terminals`);
}

/** The two shells end once the shot is taken: a later shot adopts nothing of theirs. */
const ended = (): void => {
  for (const address of started.splice(0)) endAgent("host", address);
};

export const SPACE_CLOSE_SHOTS: readonly Shot[] = [
  {
    name: "space-close-dialog",
    start: "connected",
    only: "1440",
    run: askSpaceClose,
    cleanup: ended,
  },
  {
    // The phone shell has no space list, so the question is opened wide and then read at 390: it is the modal that must fit.
    name: "space-close-dialog",
    start: "connected",
    only: "390",
    run: async (page) => {
      // Emulating a phone (3x pixels) on a loaded host outlives a capture's own budget.
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      await askSpaceClose(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByRole("dialog", { name: "Close space?" })).toBeVisible();
    },
    cleanup: ended,
  },
];
