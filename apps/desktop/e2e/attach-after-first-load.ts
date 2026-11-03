#!/usr/bin/env bun
/**
 * Runs the packaged app for electron.launch(), holding back Electron's "DevTools listening" line until the window's
 * app: document exists. Attached while the first navigation is in flight, Chromium never reports that commit and
 * electron.launch() waits for it forever (#13); Playwright's loader, which prevents this for unpackaged apps by
 * deferring `ready`, cannot be loaded into a packaged one.
 */
import { appendFileSync } from "node:fs";
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

const parseJson = (data: unknown): unknown => (typeof data === "string" ? JSON.parse(data) : undefined);

const parseEvent = (message: unknown): CdpEvent | undefined => {
  if (!isRecord(message) || typeof message["method"] !== "string" || !isRecord(message["params"])) return undefined;
  const sessionId = message["sessionId"];
  return {
    method: message["method"],
    params: message["params"],
    sessionId: typeof sessionId === "string" ? sessionId : undefined,
  };
};

const NETWORK_SERVICE = "network.mojom.NetworkService";

/** Whether a SystemInfo.getProcessInfo response lists the network service, or undefined when it is not one. */
const hasNetworkService = (response: unknown): boolean | undefined => {
  const result = isRecord(response) ? response["result"] : undefined;
  const info = isRecord(result) ? result["processInfo"] : undefined;
  if (!Array.isArray(info)) return undefined;
  return info.some((entry: unknown) => isRecord(entry) && entry["type"] === NETWORK_SERVICE);
};

/**
 * With DORIFACE_E2E_RACE_REPORT set, records in that file when this wrapper attached and what it saw at its attach, the moment a launch
 * without it would have attached (whether the first navigation was in flight and whether the network service had
 * started), and whether the network service was running by the time it releases Playwright. first-document.e2e.ts
 * checks these to know it forced the race; the second check keeps the first from passing if the service is renamed or
 * stops being a process of its own.
 */
function reportAttach(path: string, attachedAt: number, frameTree: unknown, processes: unknown): void {
  appendFileSync(path, `attached at=${attachedAt}\n`);
  const result = isRecord(frameTree) ? frameTree["result"] : undefined;
  const tree = isRecord(result) ? result["frameTree"] : undefined;
  const frame = isRecord(tree) ? tree["frame"] : undefined;
  if (isRecord(frame) && frame["url"] === "") appendFileSync(path, "first navigation in flight at attach\n");
  if (hasNetworkService(processes) === false) appendFileSync(path, "network service not started at attach\n");
}

/** Runtime events still arrive when the commit itself is lost, so the app origin's context marks the document. */
function appDocumentCreated(endpoint: string): Promise<void> {
  const socket = new WebSocket(endpoint);
  let lastId = 0;
  const raceReport = env["DORIFACE_E2E_RACE_REPORT"] ?? "";
  const ids = { frameTree: -1, attachProcesses: -1, releaseProcesses: -1 };
  let attachedAt = 0;
  const answers = new Map<number, unknown>();
  const send = (method: string, sessionId?: string): number => {
    lastId += 1;
    const params =
      method === "Target.setAutoAttach" ? { autoAttach: true, waitForDebuggerOnStart: false, flatten: true } : {};
    socket.send(JSON.stringify({ id: lastId, method, params, ...(sessionId === undefined ? {} : { sessionId }) }));
    return lastId;
  };
  return new Promise<void>((resolve, reject) => {
    const release = (): void => {
      socket.close();
      resolve();
    };
    socket.addEventListener("open", () => send("Target.setAutoAttach"));
    socket.addEventListener("message", (message) => {
      const parsed = parseJson(message.data);
      const event = parseEvent(parsed);
      if (event?.method === "Target.attachedToTarget") {
        const targetInfo = event.params["targetInfo"];
        const sessionId = event.params["sessionId"];
        if (isRecord(targetInfo) && targetInfo["type"] === "page" && typeof sessionId === "string") {
          send("Runtime.enable", sessionId);
          if (ids.frameTree < 0 && raceReport !== "") {
            attachedAt = Date.now();
            ids.frameTree = send("Page.getFrameTree", sessionId);
            ids.attachProcesses = send("SystemInfo.getProcessInfo");
          }
        }
      }
      const id = isRecord(parsed) ? parsed["id"] : undefined;
      if (typeof id === "number") answers.set(id, parsed);
      if (answers.has(ids.frameTree) && answers.has(ids.attachProcesses)) {
        reportAttach(raceReport, attachedAt, answers.get(ids.frameTree), answers.get(ids.attachProcesses));
        answers.delete(ids.frameTree);
        answers.delete(ids.attachProcesses);
      }
      if (id === ids.releaseProcesses && answers.has(ids.releaseProcesses)) {
        if (hasNetworkService(answers.get(ids.releaseProcesses)) === true) {
          appendFileSync(raceReport, "network service running at release\n");
        }
        release();
      }
      const context = event?.method === "Runtime.executionContextCreated" ? event.params["context"] : undefined;
      if (isRecord(context) && context["origin"] === APP_ORIGIN && ids.releaseProcesses < 0) {
        if (raceReport === "") release();
        else ids.releaseProcesses = send("SystemInfo.getProcessInfo");
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
