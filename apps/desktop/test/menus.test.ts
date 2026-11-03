import { describe, expect, test } from "bun:test";
import type { MenuItemConstructorOptions } from "electron";
import { contextMenuTemplate } from "../src/config/context-menu.ts";
import { APP_ORIGIN } from "../src/config/origin.ts";
import { routeWindowOpen } from "../src/config/window-open.ts";
import { menuTemplate } from "../src/main/menu.ts";

const roles = (items: readonly MenuItemConstructorOptions[]): string[] =>
  items.map((item) => item.role ?? item.type ?? item.label ?? "");

const submenuOf = (item: MenuItemConstructorOptions | undefined): MenuItemConstructorOptions[] =>
  Array.isArray(item?.submenu) ? item.submenu : [];

const noop = (): void => undefined;

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

  test("the macOS app menu opens Settings, and the page's keymap owns its shortcut", () => {
    const opened: string[] = [];
    const menu = menuTemplate({ platform: "darwin", openExternal: noop, openSettings: () => opened.push("settings") });
    expect(roles(menu)).toEqual(["appMenu", "File", "editMenu", "viewMenu", "windowMenu", "help"]);
    const app = submenuOf(menu[0]);
    expect(roles(app)).toEqual([
      "about",
      "separator",
      "Settings…",
      "separator",
      "services",
      "separator",
      "hide",
      "hideOthers",
      "unhide",
      "separator",
      "quit",
    ]);
    const settings = app[2];
    expect(settings).toMatchObject({ accelerator: "CommandOrControl+,", registerAccelerator: false });
    settings?.click?.(Object.create(null), undefined, Object.create(null));
    expect(opened).toEqual(["settings"]);
  });

  test("macOS Close Window shows Cmd+W but leaves the key to the page, which closes tabs and Settings with it", () => {
    const menu = menuTemplate({ platform: "darwin", openExternal: noop, openSettings: noop });
    const close = submenuOf(menu[1]).find((item) => item.label === "Close Window");
    expect(close).toMatchObject({ accelerator: "CommandOrControl+W", registerAccelerator: false });
    const closed: string[] = [];
    const window = { close: () => void closed.push("window") };
    close?.click?.(Object.create(null), Object.assign(Object.create(null), window), Object.create(null));
    expect(closed).toEqual(["window"]);
  });

  test("Linux and Windows keep the standard roles", () => {
    expect(roles(menuTemplate({ platform: "linux", openExternal: noop, openSettings: noop }))).toEqual([
      "fileMenu",
      "editMenu",
      "viewMenu",
      "windowMenu",
      "help",
    ]);
  });
});

describe("window.open and new-window link clicks", () => {
  test("an app page navigates the one window to its path instead of opening another", () => {
    expect(routeWindowOpen("app://doriface/pair?x=1#h", APP_ORIGIN)).toEqual({ kind: "navigate", path: "/pair?x=1#h" });
    expect(routeWindowOpen("http://127.0.0.1:5173/settings", "http://127.0.0.1:5173")).toEqual({
      kind: "navigate",
      path: "/settings",
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
