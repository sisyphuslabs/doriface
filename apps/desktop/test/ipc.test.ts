import { afterEach, describe, expect, test } from "bun:test";
import { APP_ORIGIN } from "../src/config/origin.ts";
import { openPairingLink, takePairingLink } from "../src/main/deep-link.ts";
import { ipcHandlers, type IpcSender } from "../src/main/ipc-handlers.ts";

const endpoint = { url: "ws://127.0.0.1:1/v1/hc", token: "t".repeat(43) };
const app: IpcSender = { senderFrame: { url: "app://doriface/hosts" } };
const foreign: readonly IpcSender[] = [
  { senderFrame: { url: "https://example.com/" } },
  { senderFrame: { url: "app://other/" } },
  { senderFrame: null },
];

const setup = () => {
  const opened: string[] = [];
  const painted: string[] = [];
  let starts = 0;
  let closes = 0;
  const menus: ReadonlyMap<string, string>[] = [];
  const handlers = ipcHandlers({
    setMenuKeys: (keys) => {
      menus.push(keys);
    },
    takePairingLink,
    origin: APP_ORIGIN,
    startLocalHost: async () => {
      starts += 1;
      return endpoint;
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
  });
  return { handlers, opened, painted, menus, starts: () => starts, closes: () => closes };
};

afterEach(() => void takePairingLink());

describe("IPC sender gate", () => {
  test("refuses foreign and detached frames before touching the shell or the host", async () => {
    const { handlers, opened, starts } = setup();
    openPairingLink("#p=waiting");
    await Promise.all(
      foreign.flatMap((event) => [
        expect(handlers.openExternal(event, "https://github.com/")).rejects.toThrow("refused IPC"),
        expect(handlers.startLocalHost(event)).rejects.toThrow("refused IPC"),
        expect(handlers.setWindowBackground(event, "#131518")).rejects.toThrow("refused IPC"),
        expect(handlers.closeWindow(event)).rejects.toThrow("refused IPC"),
        expect(handlers.setMenuKeys(event, { "tab.new": "super+t" })).rejects.toThrow("refused IPC"),
      ]),
    );
    for (const event of foreign) expect(() => handlers.takePairingLink(event)).toThrow("refused IPC");
    expect(opened).toEqual([]);
    expect(starts()).toBe(0);
    expect(handlers.takePairingLink(app)).toBe("#p=waiting");
  });

  test("the Shell menu takes only its own actions and short trigger text from the page, entry by entry", async () => {
    const { handlers, menus } = setup();
    expect(await handlers.setMenuKeys(app, { "pane.split:right": "super+d", "pane.go:up": "super+alt+up" })).toBe(true);
    // One entry the menu cannot take is left out; the rest still reach the menu.
    expect(await handlers.setMenuKeys(app, { "app.quit": "super+q", "tab.new": "super+t" })).toBe(true);
    expect(await handlers.setMenuKeys(app, { "tab.new": "super+t\nRole: quit", "tab.close": "super+alt+w" })).toBe(
      true,
    );
    expect(await handlers.setMenuKeys(app, ["tab.new"])).toBe(false);
    expect(menus).toEqual([
      new Map([
        ["pane.split:right", "super+d"],
        ["pane.go:up", "super+alt+up"],
      ]),
      new Map([["tab.new", "super+t"]]),
      new Map([["tab.close", "super+alt+w"]]),
    ]);
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

  test("the app origin can ask its window to close", async () => {
    const { handlers, closes } = setup();
    await handlers.closeWindow(app);
    expect(closes()).toBe(1);
  });
});
