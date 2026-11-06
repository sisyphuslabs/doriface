#!/usr/bin/env bun
/**
 * Probes a deployed web app (#668) against the build that was just deployed: the origin serves this build's
 * index.html for `/` and for `/pair` (where a pairing QR code lands), the service worker and the manifest, with the
 * headers apps/web/public/_headers sets. A deploy that is still propagating gets retried for up to two minutes.
 *
 * Usage: bun apps/web/scripts/probe-web.ts <https origin> <built dist dir>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface ProbeFailure {
  readonly path: string;
  readonly reason: string;
}

type Fetcher = (url: string) => Promise<Response>;

const PATHS = ["/", "/pair", "/settings"] as const;

/** Every mismatch between the origin and the built dist; empty when the origin serves exactly this build. */
export async function probe(origin: string, indexHtml: string, fetcher: Fetcher = fetch): Promise<ProbeFailure[]> {
  const failures: ProbeFailure[] = [];
  const check = async (path: string, test: (response: Response, body: string) => string | undefined) => {
    const response = await fetcher(new URL(path, origin).href);
    const body = await response.text();
    const reason = response.ok ? test(response, body) : `answered ${response.status}`;
    if (reason !== undefined) failures.push({ path, reason });
  };
  const sameIndex = (response: Response, body: string): string | undefined => {
    if (body !== indexHtml) return "is not this build's index.html";
    if (response.headers.get("referrer-policy") !== "no-referrer") return "has no Referrer-Policy: no-referrer";
    if (response.headers.get("x-content-type-options") !== "nosniff") return "has no X-Content-Type-Options: nosniff";
    return undefined;
  };
  await Promise.all([
    ...PATHS.map((path) => check(path, sameIndex)),
    check("/sw.js", (response) =>
      response.headers.get("content-type")?.includes("javascript") === true ? undefined : "is not JavaScript",
    ),
    check("/manifest.webmanifest", (_response, body) =>
      body.includes('"name":"doriface"') ? undefined : "is not the doriface manifest",
    ),
  ]);
  return failures;
}

if (import.meta.main) {
  const [origin, dist] = Bun.argv.slice(2);
  if (origin === undefined || dist === undefined || !origin.startsWith("https://")) {
    console.error("usage: bun apps/web/scripts/probe-web.ts <https origin> <built dist dir>");
    process.exit(2);
  }
  const indexHtml = readFileSync(join(dist, "index.html"), "utf8");
  const deadline = Date.now() + 120_000;
  const attempt = async (): Promise<ProbeFailure[]> => {
    const failures = await probe(origin, indexHtml, (url) => fetch(url, { headers: { "cache-control": "no-cache" } }));
    if (failures.length === 0 || Date.now() > deadline) return failures;
    await Bun.sleep(5_000);
    return attempt();
  };
  const failures = await attempt();
  for (const { path, reason } of failures) console.error(`::error::${origin}${path} ${reason}`);
  if (failures.length > 0) process.exit(1);
  console.log(`${origin} serves this build at ${PATHS.join(", ")}, /sw.js and /manifest.webmanifest`);
}
