#!/usr/bin/env bun
/**
 * Runs the packaged app for electron.launch(), holding back Electron's "DevTools listening" line until the window's
 * app: document exists. Attached while the first navigation is in flight, Chromium never reports that commit and
 * electron.launch() waits for it forever (#13); Playwright's loader, which prevents this for unpackaged apps by
 * deferring `ready`, cannot be loaded into a packaged one.
 */
import { argv, env, exit, stderr } from "node:process";

const APP_ORIGIN = "app://doriface";
const DEVTOOLS_LINE = /^DevTools listening on (ws:\/\/\S+)$/;

interface CdpEvent {
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly sessionId: string | undefined;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

const parseEvent = (data: unknown): CdpEvent | undefined => {
  if (typeof data !== "string") return undefined;
  const message: unknown = JSON.parse(data);
  if (!isRecord(message) || typeof message["method"] !== "string" || !isRecord(message["params"])) return undefined;
  const sessionId = message["sessionId"];
  return {
    method: message["method"],
    params: message["params"],
    sessionId: typeof sessionId === "string" ? sessionId : undefined,
  };
};

/** Runtime events still arrive when the commit itself is lost, so the app origin's context marks the document. */
function appDocumentCreated(endpoint: string): Promise<void> {
  const socket = new WebSocket(endpoint);
  let lastId = 0;
  const send = (method: string, sessionId?: string): void => {
    lastId += 1;
    const params =
      method === "Target.setAutoAttach" ? { autoAttach: true, waitForDebuggerOnStart: false, flatten: true } : {};
    socket.send(JSON.stringify({ id: lastId, method, params, ...(sessionId === undefined ? {} : { sessionId }) }));
  };
  return new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => send("Target.setAutoAttach"));
    socket.addEventListener("message", (message) => {
      const event = parseEvent(message.data);
      if (event?.method === "Target.attachedToTarget") {
        const targetInfo = event.params["targetInfo"];
        const sessionId = event.params["sessionId"];
        if (isRecord(targetInfo) && targetInfo["type"] === "page" && typeof sessionId === "string") {
          send("Runtime.enable", sessionId);
        }
      }
      const context = event?.method === "Runtime.executionContextCreated" ? event.params["context"] : undefined;
      if (isRecord(context) && context["origin"] === APP_ORIGIN) {
        socket.close();
        resolve();
      }
    });
    socket.addEventListener("error", () => reject(new Error(`could not watch ${endpoint}`)));
    socket.addEventListener("close", () => reject(new Error(`${endpoint} closed before the app document existed`)));
  });
}

const executable = env["DORIFACE_E2E_EXECUTABLE"];
if (executable === undefined || executable === "") {
  console.error("attach-after-first-load needs DORIFACE_E2E_EXECUTABLE pointing at the packaged app");
  exit(2);
}

const app = Bun.spawn([executable, ...argv.slice(2)], { stdin: "inherit", stdout: "inherit", stderr: "pipe" });
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => app.kill(signal));

// Lines leave in order through this chain; reading never waits on it, so a held line cannot fill the app's pipe.
let output: Promise<void> = Promise.resolve();
const writeLine = (line: string): boolean => stderr.write(`${line}\n`);
const write = (line: string): void => {
  output = output.then(() => writeLine(line)).then(() => undefined);
};
const forward = (line: string): void => {
  const endpoint = DEVTOOLS_LINE.exec(line)?.[1];
  if (endpoint === undefined) {
    write(line);
    return;
  }
  const created = appDocumentCreated(endpoint).catch((error: unknown) => {
    writeLine(`attach-after-first-load: ${String(error)}`);
  });
  output = output.then(() => created);
  write(line);
};

const decoder = new TextDecoder();
let pending = "";
for await (const chunk of app.stderr) {
  const lines = (pending + decoder.decode(chunk, { stream: true })).split("\n");
  pending = lines.pop() ?? "";
  for (const line of lines) forward(line);
}
if (pending !== "") forward(pending);
process.exitCode = await app.exited;
await output;
