import { agentRow, endAgent, startShell } from "./agents.ts";
import { expect, test } from "./fixtures.ts";
import { hcOn } from "./machine-switch.ts";
import { stubSpeech } from "./speech-stub.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });

const NAME = "dictate-desk";

let address = "";
test.beforeEach(() => {
  address = startShell("host", NAME);
});
test.afterEach(() => {
  endAgent("host", address);
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
