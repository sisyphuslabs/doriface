import type { Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "./fixtures.ts";

test.use({ viewport: { width: 1440, height: 900 } });

/** As in update-ready.e2e.ts: the e2e web build on its own origin, whose /sw.js turns into the next build's on deploy(). */
async function deployableSite(upstream: string): Promise<{ url: string; deploy(): void; close(): Promise<void> }> {
  let deployed = false;
  const server: Server = createServer((request, response) => {
    void (async () => {
      const answer = await fetch(new URL(request.url ?? "/", upstream));
      const body = Buffer.from(await answer.arrayBuffer());
      const next = deployed && (request.url ?? "").startsWith("/sw.js");
      response.writeHead(answer.status, {
        "content-type": answer.headers.get("content-type") ?? "application/octet-stream",
        "cache-control": "no-cache",
      });
      response.end(next ? Buffer.concat([body, Buffer.from("\n// the next build\n")]) : body);
    })().catch((error: unknown) => {
      response.writeHead(502);
      response.end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    deploy: () => {
      deployed = true;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const registration = (page: Page): Promise<{ readonly controlled: boolean; readonly waiting: boolean }> =>
  page.evaluate(async () => {
    const found = await navigator.serviceWorker.getRegistration();
    return { controlled: navigator.serviceWorker.controller !== null, waiting: (found?.waiting ?? null) !== null };
  });

interface Version {
  readonly versionId: string;
  readonly status: string;
  readonly runningStatus: string;
}

/**
 * #418, forced every run. To swap in the waiting worker, Chromium stops the old one; a request the page sends while it
 * stops starts it again. That old worker then stays active, the waiting one never activates, and no controllerchange
 * comes, so nothing reloads (seen once in 400 runs of update-ready.e2e.ts, where the Settings route's font request was
 * that request). Here the page sends requests through the old worker from just before the click until CDP shows it
 * starting again (or the page reloads), so one lands in the stop; then it sends none, so the old worker is idle.
 */
test("Reload to update reloads into the waiting worker when the old one is started again during the swap (#418)", async ({
  page,
  baseURL,
}) => {
  const versions = new Map<string, Version>();
  const { promise: restarted, resolve: sawRestart } = Promise.withResolvers<void>();
  let old: string | undefined;
  let oldStopped = false;
  const cdp = await page.context().newCDPSession(page);
  cdp.on("ServiceWorker.workerVersionUpdated", ({ versions: updated }: { versions: Version[] }) => {
    for (const version of updated) {
      versions.set(version.versionId, version);
      if (version.versionId !== old) continue;
      if (version.runningStatus === "stopped") oldStopped = true;
      else if (oldStopped && version.runningStatus === "starting") sawRestart();
    }
  });
  await cdp.send("ServiceWorker.enable");
  const site = await deployableSite(baseURL ?? "");
  try {
    await page.goto(site.url);
    const settings = page.getByRole("complementary", { name: "Workspace" }).getByRole("link", { name: /^Settings\b/ });
    await expect(settings).toHaveAccessibleName("Settings", { timeout: 20_000 });
    await expect.poll(() => registration(page), { timeout: 20_000 }).toEqual({ controlled: true, waiting: false });

    site.deploy();
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())?.update();
    });
    await expect(settings).toHaveAccessibleName("Settings, update ready", { timeout: 20_000 });
    await settings.click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.evaluate(() => Reflect.set(window, "beforeReload", true));

    old = [...versions.values()].find((version) => version.status === "activated")?.versionId;
    if (old === undefined) throw new Error("no active worker before the swap");

    await page.evaluate(() => {
      let sending = true;
      Reflect.set(window, "stopSending", () => {
        sending = false;
      });
      const send = (): void => {
        if (!sending) return;
        void fetch("/icon-192.png", { cache: "no-store" }).catch(() => undefined);
        setTimeout(send, 2);
      };
      send();
    });
    const reloaded = page.waitForEvent("load", { timeout: 20_000 });
    await page.getByRole("button", { name: "Reload to update" }).click();
    const first = await Promise.race([
      restarted.then(() => "restarted"),
      reloaded.then(
        () => "reloaded",
        () => "neither",
      ),
    ]);
    if (first === "neither")
      throw new Error("the old worker was not started again during the swap, and nothing reloaded");
    await page
      .evaluate(() => (Reflect.get(window, "stopSending") as (() => void) | undefined)?.())
      .catch(() => undefined);
    await reloaded;

    expect(await page.evaluate(() => Reflect.get(window, "beforeReload") ?? false)).toBe(false);
    await expect.poll(() => registration(page), { timeout: 20_000 }).toEqual({ controlled: true, waiting: false });
    await expect(page.getByRole("button", { name: "Reload to update" })).toHaveCount(0);
  } finally {
    await site.close();
  }
});
