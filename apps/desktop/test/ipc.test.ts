import { afterEach, describe, expect, test } from "bun:test";
import { APP_ORIGIN } from "../src/config/origin.ts";
import { openPairingLink, takePairingLink } from "../src/main/deep-link.ts";
import { HcInstallError, type HcInstalled } from "@doriface/host/hc-install";
import { Channel } from "../src/shared/bridge.ts";
import { ipcHandlers, type IpcReplySender, type IpcSender } from "../src/main/ipc-handlers.ts";
import { LocalHostStartError } from "../src/main/local-host.ts";

const endpoint = { url: "ws://127.0.0.1:1/v1/hc", token: "t".repeat(43) };
const app: IpcSender = { senderFrame: { url: "app://doriface/hosts" } };
const foreign: readonly IpcSender[] = [
  { senderFrame: { url: "https://example.com/" } },
  { senderFrame: { url: "app://other/" } },
  { senderFrame: null },
];

const setup = (
  start: () => Promise<typeof endpoint> = async () => endpoint,
  choose: () => Promise<string | undefined> = async () => undefined,
  staged: { readonly version: string } | null = null,
  install: (onPhase: (phase: string) => void) => Promise<HcInstalled> = async () => {
    throw new Error("no install");
  },
) => {
  let hcInstalls = 0;
  let chooses = 0;
  let installs = 0;
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
    chooseHc: async () => {
      chooses += 1;
      return choose();
    },
    takeUpdate: () => staged,
    installUpdate: () => {
      installs += 1;
      return staged !== null;
    },
    installHc: async (onPhase) => {
      hcInstalls += 1;
      return install(onPhase);
    },
  });
  return {
    handlers,
    opened,
    painted,
    menus,
    starts: () => starts,
    closes: () => closes,
    chooses: () => chooses,
    installs: () => installs,
    hcInstalls: () => hcInstalls,
  };
};

/** The app frame, with the replies it was sent on its own channels. */
const replying = (): { event: IpcReplySender; sent: unknown[][] } => {
  const sent: unknown[][] = [];
  return { event: { ...app, sender: { send: (...args: unknown[]) => void sent.push(args) } }, sent };
};

afterEach(() => void takePairingLink());

describe("IPC sender gate", () => {
  test("refuses foreign and detached frames before touching the shell or the host", async () => {
    const { handlers, opened, starts, installs } = setup(undefined, undefined, { version: "0.2.0" });
    openPairingLink("#p=waiting");
    await Promise.all(
      foreign.flatMap((event) => [
        expect(handlers.openExternal(event, "https://github.com/")).rejects.toThrow("refused IPC"),
        expect(handlers.openLink(event, "https://example.com/")).rejects.toThrow("refused IPC"),
        expect(handlers.startLocalHost(event)).rejects.toThrow("refused IPC"),
        expect(handlers.setWindowBackground(event, "#131518")).rejects.toThrow("refused IPC"),
        expect(handlers.closeWindow(event)).rejects.toThrow("refused IPC"),
        expect(handlers.setMenuKeys(event, { "tab.new": "super+t" })).rejects.toThrow("refused IPC"),
        expect(handlers.chooseHc(event)).rejects.toThrow("refused IPC"),
        expect(handlers.installUpdate(event)).rejects.toThrow("refused IPC"),
      ]),
    );
    for (const event of foreign) expect(() => handlers.takePairingLink(event)).toThrow("refused IPC");
    for (const event of foreign) expect(() => handlers.takeUpdate(event)).toThrow("refused IPC");
    expect(installs()).toBe(0);
    expect(opened).toEqual([]);
    expect(starts()).toBe(0);
    expect(handlers.takePairingLink(app)).toBe("#p=waiting");
  });

  test("the page reads the staged update and asks to restart into it; with none staged it reads null", async () => {
    const staged = setup(undefined, undefined, { version: "0.2.0" });
    expect(staged.handlers.takeUpdate(app)).toEqual({ version: "0.2.0" });
    expect(await staged.handlers.installUpdate(app)).toBe(true);
    expect(staged.installs()).toBe(1);
    const none = setup();
    expect(none.handlers.takeUpdate(app)).toBeNull();
    expect(await none.handlers.installUpdate(app)).toBe(false);
  });

  test("Choose hc answers the chosen file, or null when the dialog is cancelled", async () => {
    const picked = setup(undefined, async () => "/opt/herdr/hc");
    expect(await picked.handlers.chooseHc(app)).toBe("/opt/herdr/hc");
    expect(await setup().handlers.chooseHc(app)).toBeNull();
    expect(picked.chooses()).toBe(1);
  });

  test("Install herdr-core sends each phase to the page and answers the installed hc, or its failure as a value", async () => {
    const done = setup(undefined, undefined, null, async (onPhase) => {
      onPhase("download");
      onPhase("verify");
      return { version: "0.1.18", path: "/h/.local/bin/herdr-core", action: "installed" };
    });
    const page = replying();
    expect(await done.handlers.installHc(page.event)).toEqual({
      installed: { version: "0.1.18", path: "/h/.local/bin/herdr-core" },
    });
    expect(page.sent).toEqual([
      [Channel.hcInstallPhase, "download"],
      [Channel.hcInstallPhase, "verify"],
    ]);
    const damaged = setup(undefined, undefined, null, async () => {
      throw new HcInstallError("verify", "the download is damaged (checksum mismatch)");
    });
    expect(await damaged.handlers.installHc(replying().event)).toEqual({
      failed: { phase: "verify", message: "the download is damaged (checksum mismatch)" },
    });
    await expect(setup().handlers.installHc(replying().event)).rejects.toThrow("no install");
    const foreignFrame = { ...replying().event, senderFrame: { url: "https://example.com/" } };
    const refused = setup();
    await expect(refused.handlers.installHc(foreignFrame)).rejects.toThrow("refused IPC");
    expect(refused.hcInstalls()).toBe(0);
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
