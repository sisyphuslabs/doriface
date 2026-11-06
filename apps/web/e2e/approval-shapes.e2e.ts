import type { Page } from "@playwright/test";
import { agentRow } from "./agents.ts";
import { type AskingAgent, startAskingAgent } from "./approval-agent.ts";
import { expect, test } from "./fixtures.ts";

// #669: every prompt shape the card reads, answered with the agent's own keys after the live-screen re-check.
test.use({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });

let agent: AskingAgent | undefined;

test.afterEach(() => {
  agent?.end();
  agent = undefined;
});

async function asking(page: Page, scenario: "question" | "steps" | "multi"): Promise<AskingAgent> {
  const name = `asks-${scenario}-${crypto.randomUUID().slice(0, 6)}`;
  const started = startAskingAgent(name, scenario);
  agent = started;
  await page.goto("/");
  await expect(agentRow(page, name, false)).toBeVisible({ timeout: 20_000 });
  await agentRow(page, name, false).click();
  await expect(card(page, started)).toContainText("Claude Code", { timeout: 15_000 });
  return started;
}

const card = (page: Page, of: AskingAgent) => page.locator(`[data-approval="${of.address}"]`);
const row = (page: Page, of: AskingAgent, id: string) => card(page, of).locator(`[data-option="${id}"]`);

test("a question: every row in the agent's words, its words above the dialog, and the row's own key", async ({
  page,
}) => {
  const it = await asking(page, "question");
  await expect(card(page, it)).toContainText("asks a question");
  await expect(card(page, it)).toContainText("Which database should the migration target?");
  await expect(card(page, it)).toContainText("I need to know which database to use before I write the migration.");
  await expect(row(page, it, "1")).toContainText("Postgres");
  await expect(row(page, it, "1")).toContainText("The production database");
  await expect(row(page, it, "5")).toContainText("Chat about this");
  await row(page, it, "2").click();
  await expect(card(page, it)).toContainText("SQLite", { timeout: 10_000 });
  await expect(card(page, it)).toContainText("from this device");
  await expect.poll(it.keys, { timeout: 10_000 }).toEqual(["2"]);
  await expect
    .poll(it.records, { timeout: 10_000 })
    .toMatchObject([{ answer: "allow", choice: "SQLite", outcome: "sent" }]);
});

test("a typed answer: the row's key, then the text once the screen shows the row open", async ({ page }) => {
  const it = await asking(page, "question");
  await row(page, it, "4").click();
  const box = card(page, it).getByRole("textbox", { name: "Type something." });
  await box.fill("MySQL 8");
  await card(page, it).getByRole("button", { name: "Send" }).click();
  await expect(card(page, it)).toContainText("from this device", { timeout: 10_000 });
  await expect.poll(() => it.keys().join(""), { timeout: 10_000 }).toContain("MySQL 8");
  expect(it.keys()[0]).toBe("4");
  await expect(page.locator(`[data-terminal="${it.address}"]`)).toContainText("→ MySQL 8", { timeout: 10_000 });
});

test("several questions: each step on its own, then the agent's review, all in one turn", async ({ page }) => {
  const it = await asking(page, "steps");
  await expect(card(page, it)).toContainText("Step 1 of 3 · Runtime");
  await row(page, it, "2").click();
  await expect(card(page, it)).toContainText("Where should it deploy?", { timeout: 10_000 });
  await expect(card(page, it)).toContainText("Step 2 of 3 · Deploy");
  await row(page, it, "1").click();
  await expect(card(page, it)).toContainText("Ready to submit your answers?", { timeout: 10_000 });
  await expect(card(page, it)).toContainText("→ Node");
  await row(page, it, "1").click();
  await expect.poll(it.keys, { timeout: 10_000 }).toEqual(["2", "1", "1"]);
  await expect(page.locator(`[data-terminal="${it.address}"]`)).toContainText("Node, Fly", { timeout: 10_000 });
});

test("multi-select: the checked boxes are toggled on the agent's screen, then submitted", async ({ page }) => {
  const it = await asking(page, "multi");
  await row(page, it, "1").check();
  await row(page, it, "3").check();
  await card(page, it).getByRole("button", { name: "Submit" }).click();
  await expect(card(page, it)).toContainText("Ready to submit your answers?", { timeout: 10_000 });
  await expect(card(page, it)).toContainText("→ Lint, Unit tests");
  await row(page, it, "1").click();
  await expect.poll(it.keys, { timeout: 10_000 }).toEqual(["1", "3", "\u001B[C", "1"]);
  await expect(page.locator(`[data-terminal="${it.address}"]`)).toContainText("Lint, Unit tests", { timeout: 10_000 });
});

test("a question's cancel presses Esc and is recorded as a decline", async ({ page }) => {
  const it = await asking(page, "question");
  await card(page, it).locator("[data-cancel]").click();
  await expect.poll(it.keys, { timeout: 10_000 }).toEqual(["\u001B"]);
  // The key reaches the agent before the claim is settled as `sent`.
  await expect
    .poll(it.records, { timeout: 10_000 })
    .toMatchObject([{ answer: "deny", choice: "Cancel", outcome: "sent" }]);
});
