import { afterEach, describe, expect, test } from "bun:test";
import { APP_ORIGIN } from "../src/config/origin.ts";
import { openPairingLink, takePairingLink } from "../src/main/deep-link.ts";
import { ipcHandlers, type IpcSender } from "../src/main/ipc-handlers.ts";
import { LocalHostStartError } from "../src/main/local-host.ts";

const endpoint = { url: "ws://127.0.0.1:1/v1/hc", token: "t".repeat(43) };
const app: IpcSender = { senderFrame: { url: "app://doriface/hosts" } };
const foreign: readonly IpcSender[] = [
  { senderFrame: { url: "https://example.com/" } },
  { senderFrame: { url: "app://other/" } },
  { senderFrame: null },
];

const setup = (start: () => Promise<typeof endpoint> = async () => endpoint) => {
  const opened: string[] = [];
  const painted: string[] = [];
  const zooms: string[] = [];
  let starts = 0;
  let closes = 0;
  const handlers = ipcHandlers({
    takePairingLink,
    origin: APP_ORIGIN,
    startLocalHost: async () => {
      starts += 1;
      return start();
    },
    openExternal: async (url) => {
      opened.push(url);
    },
    setWindowBackground: (color) => {
      painted.push(color);
    },
    closeWindow: () => {
      closes += 1;
    },
    zoomWindow: (step) => {
      zooms.push(step);
    },
  });
  return { handlers, opened, painted, zooms, starts: () => starts, closes: () => closes };
};

afterEach(() => void takePairingLink());

describe("IPC sender gate", () => {
  test("refuses foreign and detached frames before touching the shell or the host", async () => {
    const { handlers, opened, zooms, starts } = setup();
    openPairingLink("#p=waiting");
    await Promise.all(
      foreign.flatMap((event) => [
        expect(handlers.openExternal(event, "https://github.com/")).rejects.toThrow("refused IPC"),
        expect(handlers.openLink(event, "https://example.com/")).rejects.toThrow("refused IPC"),
        expect(handlers.startLocalHost(event)).rejects.toThrow("refused IPC"),
        expect(handlers.setWindowBackground(event, "#131518")).rejects.toThrow("refused IPC"),
        expect(handlers.closeWindow(event)).rejects.toThrow("refused IPC"),
        expect(handlers.zoomWindow(event, "out")).rejects.toThrow("refused IPC"),
      ]),
    );
    for (const event of foreign) expect(() => handlers.takePairingLink(event)).toThrow("refused IPC");
    expect(opened).toEqual([]);
    expect(zooms).toEqual([]);
    expect(starts()).toBe(0);
    expect(handlers.takePairingLink(app)).toBe("#p=waiting");
  });

  test("the app origin takes a waiting pairing link once", () => {
    const { handlers } = setup();
    openPairingLink("#p=waiting");
    expect(handlers.takePairingLink(app)).toBe("#p=waiting");
    expect(handlers.takePairingLink(app)).toBeNull();
  });

  test("the app origin opens only normalized allowlisted links", async () => {
    const { handlers, opened } = setup();
    expect(await handlers.openExternal(app, "https://GitHub.com/x/../sisyphuslabs")).toBe(true);
    const refused = await Promise.all(
      ["https://example.com/", "http://github.com/", 42, undefined].map((candidate) =>
        handlers.openExternal(app, candidate),
      ),
    );
    expect(refused).toEqual([false, false, false, false]);
    expect(opened).toEqual(["https://github.com/sisyphuslabs"]);
  });

  test("the app origin can start the local host", async () => {
    const { handlers, starts } = setup();
    expect(await handlers.startLocalHost(app)).toBe(endpoint);
    expect(starts()).toBe(1);
  });

  test("a host that did not start answers with its failure as a value; any other error still rejects", async () => {
    const failure = { code: "hc-binary-missing", message: "not found", path: "/x/hc", details: "raw" };
    const failed = setup(async () => Promise.reject(new LocalHostStartError(failure)));
    expect(await failed.handlers.startLocalHost(app)).toEqual({ failure });
    const broken = setup(async () => Promise.reject(new Error("bug")));
    await expect(broken.handlers.startLocalHost(app)).rejects.toThrow("bug");
  });

  test("the app origin can set the window background to a hex colour and nothing else", async () => {
    const { handlers, painted } = setup();
    expect(await handlers.setWindowBackground(app, "#131518")).toBe(true);
    const refused = await Promise.all(
      ["red", "#13151", "#1315189", "url(x)", 42, undefined].map((candidate) =>
        handlers.setWindowBackground(app, candidate),
      ),
    );
    expect(refused).toEqual([false, false, false, false, false, false]);
    expect(painted).toEqual(["#131518"]);
  });

  test("the app origin can zoom its window one step in, out or back, and nothing else", async () => {
    const { handlers, zooms } = setup();
    const taken = await Promise.all(["in", "out", "reset"].map((step) => handlers.zoomWindow(app, step)));
    const refused = await Promise.all(["0.5", 0.5, "IN", undefined].map((step) => handlers.zoomWindow(app, step)));
    expect(taken).toEqual([true, true, true]);
    expect(refused).toEqual([false, false, false, false]);
    expect(zooms).toEqual(["in", "out", "reset"]);
  });

  test("the app origin can ask its window to close", async () => {
    const { handlers, closes } = setup();
    await handlers.closeWindow(app);
    expect(closes()).toBe(1);
  });

  test("a terminal link opens any http, https or mailto target in the system browser, and nothing else", async () => {
    const { handlers, opened } = setup();
    expect(await handlers.openLink(app, "https://anywhere.example/a b")).toBe(true);
    expect(await handlers.openLink(app, "http://plain.example")).toBe(true);
    expect(await handlers.openLink(app, "mailto:me@example.com")).toBe(true);
    const refused = [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,x",
      "vscode://open",
      "https://user:pw@example.com/",
      "not a url",
      42,
    ];
    expect(await Promise.all(refused.map((candidate) => handlers.openLink(app, candidate)))).toEqual(
      refused.map(() => false),
    );
    expect(opened).toEqual(["https://anywhere.example/a%20b", "http://plain.example/", "mailto:me@example.com"]);
  });
});
