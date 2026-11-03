import { describe, expect, test } from "bun:test";
import { contentSecurityPolicy } from "../src/config/csp.ts";
import { allowedExternal, isAllowedExternal } from "../src/config/external.ts";
import { APP_ORIGIN, isSameOrigin, loopbackDevUrl } from "../src/config/origin.ts";
import { isGrantable } from "../src/config/permissions.ts";
import { contextMenuTemplate } from "../src/config/context-menu.ts";
import { routeWindowOpen } from "../src/config/window-open.ts";
import { parsePlacement, restorePlacement } from "../src/config/window-state.ts";
import {
  DEFAULT_WINDOW_SIZE,
  MAC_INSET_CSS,
  MAC_TITLEBAR_CSS,
  MIN_WINDOW_SIZE,
  secureWebPreferences,
  TITLEBAR_INSET_START,
  TITLEBAR_ROW_HEIGHT,
  TRAFFIC_LIGHT_POSITION,
  TRAFFIC_LIGHTS,
  WINDOW_BACKGROUND,
  windowOptions,
} from "../src/config/window.ts";
import { menuTemplate } from "../src/main/menu.ts";
import { VERSION_ARG } from "../src/shared/bridge.ts";

const directives = (csp: string): ReadonlyMap<string, readonly string[]> =>
  new Map(
    csp.split("; ").map((directive) => {
      const [name = "", ...sources] = directive.split(" ");
      return [name, sources] as const;
    }),
  );

describe("main process window config", () => {
  test("webPreferences isolate and sandbox the renderer", () => {
    expect(secureWebPreferences("/app/preload.cjs", "1.2.3")).toEqual({
      preload: "/app/preload.cjs",
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      safeDialogs: true,
      spellcheck: false,
      additionalArguments: [`${VERSION_ARG}1.2.3`],
    });
  });

  test("macOS gets a hidden-inset titlebar with positioned traffic lights; others keep the native frame", () => {
    const prefs = secureWebPreferences("/p", "0.0.0");
    const look = { dark: true, placement: DEFAULT_WINDOW_SIZE };
    const mac = windowOptions("darwin", prefs, look);
    expect(mac.titleBarStyle).toBe("hiddenInset");
    expect(mac.trafficLightPosition).toEqual({ x: TRAFFIC_LIGHT_POSITION.x, y: TRAFFIC_LIGHT_POSITION.y });
    expect(mac.webPreferences).toBe(prefs);
    for (const platform of ["linux", "win32"] as const) {
      const options = windowOptions(platform, prefs, look);
      expect(options.titleBarStyle).toBeUndefined();
      expect(options.trafficLightPosition).toBeUndefined();
      expect(options.show).toBe(false);
    }
  });

  test("the titlebar sheets drag the window from titlebar rows and move content clear of the window buttons", () => {
    expect(TRAFFIC_LIGHTS.x).toBe(TRAFFIC_LIGHT_POSITION.x);
    expect(TRAFFIC_LIGHTS.y).toBe(TRAFFIC_LIGHT_POSITION.y);
    expect(TITLEBAR_INSET_START).toBeGreaterThan(TRAFFIC_LIGHTS.x + TRAFFIC_LIGHTS.width);
    expect(MAC_TITLEBAR_CSS).toContain(`height: ${TRAFFIC_LIGHT_POSITION.y}px; -webkit-app-region: drag;`);
    expect(MAC_TITLEBAR_CSS).toContain("[data-titlebar] { -webkit-app-region: drag; }");
    expect(MAC_TITLEBAR_CSS).toMatch(/\[data-titlebar\] :is\([^)]*button[^)]*\) \{ -webkit-app-region: no-drag; \}/);
    expect(MAC_INSET_CSS).toBe(`:root { --titlebar-inset-start: ${TITLEBAR_INSET_START}px; }`);
  });

  test("the window buttons are centred on the top row", () => {
    expect(TRAFFIC_LIGHTS.y + TRAFFIC_LIGHTS.height / 2).toBe(TITLEBAR_ROW_HEIGHT / 2);
  });

  test("the window opens hidden on the system appearance's background, no smaller than the desktop layout", () => {
    const prefs = secureWebPreferences("/p", "0.0.0");
    const placement = { x: 40, y: 60, width: 1000, height: 700 };
    const dark = windowOptions("darwin", prefs, { dark: true, placement });
    const light = windowOptions("darwin", prefs, { dark: false, placement });
    expect(dark).toMatchObject({ ...placement, show: false, backgroundColor: WINDOW_BACKGROUND.dark });
    expect(light.backgroundColor).toBe(WINDOW_BACKGROUND.light);
    expect({ width: dark.minWidth, height: dark.minHeight }).toEqual(MIN_WINDOW_SIZE);
    expect(MIN_WINDOW_SIZE.width).toBeGreaterThanOrEqual(768);
  });
});

describe("window placement across launches", () => {
  const laptop = { x: 0, y: 25, width: 1470, height: 931 };
  const external = { x: 1470, y: 0, width: 2560, height: 1415 };

  test("a saved placement on a display comes back as it was", () => {
    const saved = { x: 1600, y: 100, width: 1200, height: 800 };
    expect(restorePlacement(saved, [laptop, external])).toEqual(saved);
  });

  test("a placement on an unplugged display opens centred at its size, clamped to the minimum", () => {
    expect(restorePlacement({ x: 1600, y: 100, width: 1200, height: 800 }, [laptop])).toEqual({
      width: 1200,
      height: 800,
    });
    expect(restorePlacement({ x: 5000, y: 100, width: 300, height: 200 }, [laptop])).toEqual(MIN_WINDOW_SIZE);
  });

  test("a placement larger than its display shrinks to the work area, and none at all is the default", () => {
    expect(restorePlacement({ x: 0, y: 25, width: 2560, height: 1600 }, [laptop])).toEqual(laptop);
    expect(restorePlacement(undefined, [laptop])).toEqual(DEFAULT_WINDOW_SIZE);
  });

  test("only four finite numbers read from disk are a placement", () => {
    expect(parsePlacement({ x: 1, y: 2, width: 3, height: 4 })).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    for (const bad of [null, "x", {}, { x: 1, y: 2, width: 3 }, { x: 1, y: 2, width: 3, height: Number.NaN }]) {
      expect(parsePlacement(bad)).toBeUndefined();
    }
  });
});

const roles = (items: readonly { readonly role?: string; readonly type?: string }[]): string[] =>
  items.map((item) => item.role ?? item.type ?? "");

describe("menus", () => {
  const flags = { canCut: true, canCopy: false, canPaste: true };

  test("a text field gets native Cut, Copy, Paste and Select All; selected text gets Copy; elsewhere nothing", () => {
    const field = contextMenuTemplate({ isEditable: true, selectionText: "", editFlags: flags });
    expect(roles(field)).toEqual(["cut", "copy", "paste", "separator", "selectAll"]);
    expect(field.map((item) => item.enabled)).toEqual([true, false, true, undefined, undefined]);
    expect(roles(contextMenuTemplate({ isEditable: false, selectionText: "ls -la", editFlags: flags }))).toEqual([
      "copy",
    ]);
    expect(contextMenuTemplate({ isEditable: false, selectionText: " ", editFlags: flags })).toEqual([]);
  });

  test("macOS gets the standard app menu with Settings\u2026, whose shortcut the page's keymap owns", () => {
    const opened: string[] = [];
    const menu = menuTemplate({
      platform: "darwin",
      openExternal: () => undefined,
      openSettings: () => opened.push("settings"),
    });
    expect(roles(menu)).toEqual(["appMenu", "fileMenu", "editMenu", "viewMenu", "windowMenu", "help"]);
    const submenu = menu[0]?.submenu;
    const items = Array.isArray(submenu) ? submenu : [];
    expect(roles(items)).toEqual([
      "about",
      "separator",
      "",
      "separator",
      "services",
      "separator",
      "hide",
      "hideOthers",
      "unhide",
      "separator",
      "quit",
    ]);
    const settings = items[2];
    expect(settings).toMatchObject({
      label: "Settings\u2026",
      accelerator: "CommandOrControl+,",
      registerAccelerator: false,
    });
    settings?.click?.(Object.create(null), undefined, Object.create(null));
    expect(opened).toEqual(["settings"]);
    expect(
      roles(menuTemplate({ platform: "linux", openExternal: () => undefined, openSettings: () => undefined })),
    ).toEqual(["fileMenu", "editMenu", "viewMenu", "windowMenu", "help"]);
  });
});

describe("window.open and new-window link clicks", () => {
  test("an app page loads in the one window instead of opening another", () => {
    expect(routeWindowOpen("app://doriface/pair", APP_ORIGIN)).toEqual({
      kind: "same-window",
      url: "app://doriface/pair",
    });
    expect(routeWindowOpen("http://127.0.0.1:5173/settings", "http://127.0.0.1:5173")).toEqual({
      kind: "same-window",
      url: "http://127.0.0.1:5173/settings",
    });
  });

  test("an allowlisted link goes to the browser and anything else goes nowhere", () => {
    expect(routeWindowOpen("https://github.com/sisyphuslabs/doriface#readme", APP_ORIGIN)).toEqual({
      kind: "browser",
      url: "https://github.com/sisyphuslabs/doriface#readme",
    });
    for (const url of ["https://example.com/", "app://evil/", "file:///etc/passwd", "javascript:alert(1)", "x"]) {
      expect(routeWindowOpen(url, APP_ORIGIN)).toEqual({ kind: "none" });
    }
  });
});

describe("content security policy", () => {
  test("production allows only same-origin scripts and styles, plus WebAssembly", () => {
    const csp = directives(contentSecurityPolicy());
    expect(csp.get("default-src")).toEqual(["'self'"]);
    expect(csp.get("script-src")).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(csp.get("style-src")).toEqual(["'self'"]);
    for (const name of ["object-src", "frame-src", "frame-ancestors", "base-uri", "form-action"]) {
      expect(csp.get(name)).toEqual(["'none'"]);
    }
    expect(csp.get("connect-src")).toEqual(["'self'", "ws:", "wss:", "http://127.0.0.1:*", "http://localhost:*"]);
    expect([...csp.values()].flat()).not.toContain("'unsafe-eval'");
    expect([...csp.values()].flat()).not.toContain("'unsafe-inline'");
  });

  test("dev mode admits Vite's inline preamble and nothing else extra", () => {
    const prod = directives(contentSecurityPolicy());
    const dev = directives(contentSecurityPolicy({ devServer: "http://localhost:5173" }));
    expect(dev.get("script-src")).toEqual(["'self'", "'wasm-unsafe-eval'", "'unsafe-inline'"]);
    expect(dev.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect([...dev.keys()]).toEqual([...prod.keys()]);
    for (const [name, sources] of prod) {
      if (name !== "script-src" && name !== "style-src") expect(dev.get(name)).toEqual(sources);
    }
  });
});

describe("origin, external links and permissions", () => {
  test("the app origin matches by scheme and host", () => {
    expect(isSameOrigin("app://doriface/index.html", APP_ORIGIN)).toBe(true);
    expect(isSameOrigin("app://DoriFace/index.html", APP_ORIGIN)).toBe(true);
    expect(isSameOrigin("app://evil/index.html", APP_ORIGIN)).toBe(false);
    expect(isSameOrigin("https://doriface/", APP_ORIGIN)).toBe(false);
    expect(isSameOrigin("not a url", APP_ORIGIN)).toBe(false);
  });

  test("only a loopback http dev server may become the app origin", () => {
    expect(loopbackDevUrl("http://localhost:5173")).toBe("http://localhost:5173/");
    expect(loopbackDevUrl("http://127.0.0.1:5173/")).toBe("http://127.0.0.1:5173/");
    expect(loopbackDevUrl("http://[::1]:5173")).toBe("http://[::1]:5173/");
    for (const url of ["https://localhost:5173", "http://example.com:5173", "http://10.0.0.2:5173", "file:///x", "x"]) {
      expect(() => loopbackDevUrl(url)).toThrow("refusing dev server");
    }
  });

  test("only https links to allowlisted hosts open externally", () => {
    expect(isAllowedExternal("https://github.com/sisyphuslabs/doriface")).toBe(true);
    expect(isAllowedExternal("https://docs.omo.dev/x")).toBe(true);
    expect(isAllowedExternal("http://github.com/")).toBe(false);
    expect(isAllowedExternal("https://github.com.evil.example/")).toBe(false);
    expect(isAllowedExternal("https://user:pw@github.com/")).toBe(false);
    expect(isAllowedExternal("file:///etc/passwd")).toBe(false);
    expect(isAllowedExternal("javascript:alert(1)")).toBe(false);
    expect(allowedExternal("https://GitHub.com/a/../sisyphuslabs")).toBe("https://github.com/sisyphuslabs");
    expect(allowedExternal("https://example.com/")).toBeUndefined();
  });

  test("permissions are denied unless the app origin asks for a clipboard write", () => {
    expect(isGrantable("clipboard-sanitized-write", "app://doriface/", APP_ORIGIN)).toBe(true);
    expect(isGrantable("clipboard-sanitized-write", "https://example.com/", APP_ORIGIN)).toBe(false);
    for (const permission of ["media", "geolocation", "notifications", "clipboard-read", "openExternal"]) {
      expect(isGrantable(permission, "app://doriface/", APP_ORIGIN)).toBe(false);
    }
  });
});
