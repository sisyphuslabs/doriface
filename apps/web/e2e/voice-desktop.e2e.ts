import { agentRow, endAgent, startShell } from "./agents.ts";
import { expect, test } from "./fixtures.ts";
import { hcOn } from "./machine-switch.ts";
import { stubSpeech } from "./speech-stub.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });

const NAME = "dictate-desk";
const OTHER = "dictate-other";

let address = "";
let other = "";
test.beforeEach(() => {
  address = startShell("host", NAME);
  other = startShell("host", OTHER);
});
test.afterEach(() => {
  endAgent("host", address);
  endAgent("host", other);
});

test("Dictate in the tab bar docks under the focused pane and types into it without Enter", async ({ page }) => {
  const speech = await stubSpeech(page);
  await page.goto("/");
  await agentRow(page, NAME, false).click();
  const pane = page.locator('[data-focused="true"]');
  await expect(pane.locator(`[data-terminal="${address}"]`)).toContainText("$", { timeout: 15_000 });

  await page.getByRole("button", { name: `Dictate into ${NAME}` }).click();
  await pane.getByRole("button", { name: "Allow" }).click();
  await expect(pane.getByRole("status").filter({ hasText: "Listening" })).toBeVisible();
  await speech.say(["echo desk-$((6*7))", true]);
  await pane.getByRole("button", { name: "Done" }).click();
  await speech.end();
  await expect(pane.getByRole("textbox", { name: `Transcript for ${NAME}` })).toHaveValue("echo desk-$((6*7))");
  await pane.getByRole("button", { name: `Type into ${NAME}` }).click();

  await expect.poll(() => hcOn("host", ["read", address])).toContain("$ echo desk-$((6*7))");
  expect(hcOn("host", ["read", address])).not.toContain("desk-42");
  // Typing went back to the terminal, so Return is the user's next key.
  await expect(pane.locator(`[data-terminal="${address}"]`).getByRole("textbox")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => hcOn("host", ["read", address])).toContain("desk-42");
});

test("moving focus to another tab ends the dictation, so nothing heard for one pane is typed into another", async ({
  page,
}) => {
  const speech = await stubSpeech(page);
  await page.goto("/");
  await agentRow(page, OTHER, false).click();
  await expect(page.locator(`[data-terminal="${other}"]`)).toContainText("$", { timeout: 15_000 });
  await agentRow(page, NAME, false).click();
  await expect(page.locator(`[data-focused="true"] [data-terminal="${address}"]`)).toContainText("$", {
    timeout: 15_000,
  });

  await page.getByRole("button", { name: `Dictate into ${NAME}` }).click();
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(page.locator("[data-voice-strip]")).toHaveAttribute("data-voice-strip", "listening");
  await page.getByRole("tablist", { name: "Tabs" }).getByRole("tab").filter({ hasText: OTHER }).click();
  await expect(page.locator(`[data-focused="true"] [data-terminal="${other}"]`)).toBeVisible();

  await expect(page.locator("[data-voice-strip]")).toHaveCount(0);
  expect(await speech.aborts()).toBe(1);
  await speech.say(["echo stray", true]);
  await speech.end();
  await expect(page.locator("[data-voice-strip]")).toHaveCount(0);
  expect(hcOn("host", ["read", other])).not.toContain("echo stray");
  expect(hcOn("host", ["read", address])).not.toContain("echo stray");
});
