#!/usr/bin/env bun
/**
 * Test harness for first-document.e2e.ts, run as electron.launch()'s executable. It starts DORIFACE_E2E_INNER (a JSON
 * array: the launch helper's executable and arguments) with the arguments electron.launch() adds, and points
 * Playwright at a CDP proxy instead of the app. The proxy holds each page session's Page.enable until that page has an
 * app: execution context, so a session attached during the first navigation never receives that commit's
 * Page.frameNavigated: the event lost in #13. A session attached after the first load is unaffected. Every hold is
 * recorded in the file DORIFACE_E2E_RACE_REPORT names, so the test can tell that the race was forced.
 */
import { appendFileSync } from "node:fs";
import { argv, env, exit, stderr } from "node:process";

const APP_ORIGIN = "app://doriface";
const DEVTOOLS_LINE = /^DevTools listening on (ws:\/\/\S+)$/;

const parsed: unknown = JSON.parse(env["DORIFACE_E2E_INNER"] ?? "null");
if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((part) => typeof part === "string")) {
  console.error("late-page-enable needs DORIFACE_E2E_INNER: a JSON array of the executable and its arguments");
  exit(2);
}
const inner: string[] = parsed;

interface Message {
  readonly method: string | undefined;
  readonly sessionId: string | undefined;
  readonly origin: string | undefined;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;
const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** The fields the proxy routes on; anything that is not a JSON object passes through untouched. */
const parseMessage = (data: string): Message | undefined => {
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (!isRecord(message)) return undefined;
  const params = message["params"];
  const context = isRecord(params) ? params["context"] : undefined;
  return {
    method: text(message["method"]),
    sessionId: text(message["sessionId"]),
    origin: isRecord(context) ? text(context["origin"]) : undefined,
  };
};

const report = (line: string): void => {
  const path = env["DORIFACE_E2E_RACE_REPORT"];
  if (path !== undefined && path !== "") appendFileSync(path, `${line}\n`);
};

interface Connection {
  readonly upstream: WebSocket;
  readonly pending: string[];
  readonly committed: Set<string>;
  readonly held: Map<string, string[]>;
}

const toApp = (connection: Connection, data: string): void => {
  if (connection.upstream.readyState === WebSocket.OPEN) connection.upstream.send(data);
  else connection.pending.push(data);
};

function serveProxy(upstreamUrl: string): string {
  const server = Bun.serve<Connection>({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, bunServer) {
      const data: Connection = {
        upstream: new WebSocket(upstreamUrl),
        pending: [],
        committed: new Set(),
        held: new Map(),
      };
      return bunServer.upgrade(request, { data }) ? undefined : new Response("", { status: 400 });
    },
    websocket: {
      open(client) {
        const connection = client.data;
        const { upstream } = connection;
        upstream.addEventListener("open", () => connection.pending.splice(0).forEach((data) => upstream.send(data)));
        upstream.addEventListener("message", (event) => {
          const data = String(event.data);
          const message = parseMessage(data);
          const session = message?.sessionId;
          if (
            session !== undefined &&
            message?.method === "Runtime.executionContextCreated" &&
            message.origin === APP_ORIGIN &&
            !connection.committed.has(session)
          ) {
            connection.committed.add(session);
            for (const held of connection.held.get(session) ?? []) toApp(connection, held);
            connection.held.delete(session);
          }
          client.send(data);
        });
        upstream.addEventListener("close", () => client.close());
      },
      message(client, raw) {
        const connection = client.data;
        const data = String(raw);
        const message = parseMessage(data);
        const session = message?.sessionId;
        if (message?.method === "Page.enable" && session !== undefined && !connection.committed.has(session)) {
          connection.held.set(session, [...(connection.held.get(session) ?? []), data]);
          report("held a Page.enable");
        } else {
          toApp(connection, data);
        }
      },
      close(client) {
        client.data.upstream.close();
      },
    },
  });
  return `ws://127.0.0.1:${server.port}${new URL(upstreamUrl).pathname}`;
}

const [executable, ...innerArgs] = inner;
const app = Bun.spawn([executable ?? "", ...innerArgs, ...argv.slice(2)], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "pipe",
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => app.kill(signal));

const decoder = new TextDecoder();
let partial = "";
const forward = (line: string): void => {
  const endpoint = DEVTOOLS_LINE.exec(line)?.[1];
  stderr.write(`${endpoint === undefined ? line : `DevTools listening on ${serveProxy(endpoint)}`}\n`);
};
for await (const chunk of app.stderr) {
  const lines = (partial + decoder.decode(chunk, { stream: true })).split("\n");
  partial = lines.pop() ?? "";
  for (const line of lines) forward(line);
}
if (partial !== "") forward(partial);
exit(await app.exited);
