import { expect, test } from "./fixtures.ts";

interface ManifestIcon {
  readonly src: string;
  readonly type: string;
}

function isIcon(value: unknown): value is ManifestIcon {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "src") === "string";
}

test("the app is installable, serves its icons and registers its service worker", async ({ page, request }, info) => {
  const manifest: unknown = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ name: "doriface", display: "standalone", start_url: "/" });
  const icons: unknown = typeof manifest === "object" && manifest !== null ? Reflect.get(manifest, "icons") : null;
  expect(Array.isArray(icons)).toBe(true);
  const listed = Array.isArray(icons) ? icons.filter(isIcon) : [];
  const served = await Promise.all(
    listed.map(async (icon) => (await request.get(`/${icon.src}`)).headers()["content-type"]),
  );
  expect(served).toEqual(listed.map((icon) => icon.type));

  await page.goto("/settings");
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(new URL(scope).pathname).toBe("/");

  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  await info.attach("installability.json", {
    body: JSON.stringify(installabilityErrors, null, 2),
    contentType: "application/json",
  });
  expect(installabilityErrors).toEqual([]);
});
