// A permission notice's Allow and Deny, on #192's fake Claude Code agent: Allow opens the app and the page answers,
// Deny answers from the notification; either sends the agent's own key only while its dialog is on the live screen.
import type { Page } from "@playwright/test";
import { type AskingAgent, startAskingAgent } from "./approval-agent.ts";
import { expect, test } from "./fixtures.ts";
import { deliverPush, type Posted, serviceWorker, shownNotifications, tapNotification } from "./push.ts";
import { pushSuite, turnOn } from "./push-suite.ts";

const suite = pushSuite();

function asking(name: string): AskingAgent {
  const agent = startAskingAgent(name);
  suite.later(() => agent.end());
  return agent;
}

const banner = (page: Page) => page.locator("[data-prompt-answer]");

test("a permission notice is opaque; Allow opens the pane and the page answers once, with the agent's own key", async ({
  page,
  context,
}, info) => {
  await turnOn(page);
  const agent = asking("push-ask-9d4");
  const posted: Posted = await suite.service().next();
  expect(posted.notice).toEqual({
    v: 1,
    n: expect.stringMatching(/^[\w-]{22}$/),
    k: "permission",
    h: expect.any(String),
  });
  const wire = JSON.stringify(posted.headers) + Buffer.from(posted.body).toString("latin1");
  for (const plain of ["push-ask-9d4", "touch probe-a.txt", "claude-code"]) expect(wire).not.toContain(plain);

  const worker = await serviceWorker(context);
  const tag = String(posted.notice["n"]);
  await deliverPush(context, JSON.stringify(posted.notice));
  await expect
    .poll(() => shownNotifications(worker))
    .toEqual([{ title: "doriface", body: "An agent is asking for permission.", tag, actions: ["allow", "deny"] }]);
  await tapNotification(worker, tag, "allow");
  await expect(page.locator(`[data-terminal="${agent.address}"]`)).toBeVisible({ timeout: 15_000 });
  await expect(banner(page)).toHaveAttribute("data-prompt-answer", "answered", { timeout: 15_000 });
  await expect.poll(() => agent.keys()).toEqual(["1"]);
  await page.screenshot({ path: info.outputPath("allow-answered.png") });

  // The same notice again: the prompt is answered, so nothing is typed and the banner says so.
  await banner(page).getByRole("button", { name: "Dismiss", exact: true }).click();
  await deliverPush(context, JSON.stringify(posted.notice));
  await tapNotification(worker, tag, "allow");
  await expect(banner(page)).toHaveAttribute("data-prompt-answer", "stale", { timeout: 15_000 });
  await page.screenshot({ path: info.outputPath("allow-stale.png") });
  expect(agent.keys()).toEqual(["1"]);
});

test("a prompt answered in the terminal first is stale: Allow opens the pane, says so, and sends nothing", async ({
  page,
  context,
}) => {
  await turnOn(page);
  const agent = asking("push-stale-3b1");
  const posted = await suite.service().next();
  agent.typeInTerminal("x");
  await expect.poll(() => agent.keys()).toEqual(["x"]);
  const worker = await serviceWorker(context);
  await deliverPush(context, JSON.stringify(posted.notice));
  await tapNotification(worker, String(posted.notice["n"]), "allow");
  await expect(banner(page)).toHaveAttribute("data-prompt-answer", "stale", { timeout: 15_000 });
  await expect(page.locator(`[data-terminal="${agent.address}"]`)).toBeVisible();
  expect(agent.keys()).toEqual(["x"]);
});

test("Deny answers from the notification with the agent's own Esc, without opening the app", async ({
  page,
  context,
}) => {
  await turnOn(page);
  const agent = asking("push-deny-6e2");
  const posted = await suite.service().next();
  const worker = await serviceWorker(context);
  await deliverPush(context, JSON.stringify(posted.notice));
  await tapNotification(worker, String(posted.notice["n"]), "deny");
  await expect.poll(() => agent.keys()).toEqual(["\u001B"]);
  await expect(page).toHaveURL(/\/settings$/);
  await expect(banner(page)).toHaveCount(0);
});
