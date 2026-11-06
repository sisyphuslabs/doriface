import { afterEach, describe, expect, test } from "bun:test";
import { probe } from "./probe-web.ts";

const INDEX = '<!doctype html><div id="root"></div>';
const SECURE = { "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };

type Route = (path: string) => Response;

const servers: { stop: (force?: boolean) => void }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

/** A local origin answering like the Worker would, or like a broken deploy when a test swaps a route. */
function origin(route: Route): string {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (request) => route(new URL(request.url).pathname),
  });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

const worker: Route = (path) => {
  if (path === "/sw.js") return new Response("self.x=1", { headers: { "content-type": "text/javascript" } });
  if (path === "/manifest.webmanifest") return new Response('{"name":"doriface"}');
  return new Response(INDEX, { headers: { "content-type": "text/html", ...SECURE } });
};

describe("probe-web", () => {
  test("an origin serving this build at every route, with the headers, passes", async () => {
    expect(await probe(origin(worker), INDEX)).toEqual([]);
  });

  test("names each path a stale deploy, a missing SPA fallback or a missing header breaks", async () => {
    const broken = origin((path) => {
      if (path === "/pair") return new Response("not found", { status: 404 });
      if (path === "/settings") return new Response(INDEX, { headers: { "x-content-type-options": "nosniff" } });
      if (path === "/") return new Response("<!doctype html>old build", { headers: SECURE });
      return worker(path);
    });
    const failures = await probe(broken, INDEX);
    expect(failures.toSorted((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: "/", reason: "is not this build's index.html" },
      { path: "/pair", reason: "answered 404" },
      { path: "/settings", reason: "has no Referrer-Policy: no-referrer" },
    ]);
  });
});
