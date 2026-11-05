import type { MenuItemConstructorOptions } from "electron";
import type { DesktopPlatform, ZoomStep } from "../shared/bridge.ts";
import { shellMenu } from "./shell-menu.ts";

export const REPOSITORY_URL = "https://github.com/sisyphuslabs/doriface";

export interface MenuOptions {
  readonly platform: DesktopPlatform;
  readonly openExternal: (url: string) => void;
  readonly openSettings: () => void;
  readonly zoomWindow: (step: ZoomStep) => void;
  /** The page's trigger per Shell menu action, as it last reported them; empty until it has. */
  readonly keys: ReadonlyMap<string, string>;
  readonly runAction: (action: string) => void;
}

/**
 * The macOS app menu in its standard order, with Settings… after About. The page's keymap owns Cmd+, (it also closes
 * Settings), so the item shows the shortcut without registering it and never runs twice for one key press.
 */
function appMenu(openSettings: () => void): MenuItemConstructorOptions {
  return {
    role: "appMenu",
    submenu: [
      { role: "about" },
      { type: "separator" },
      { label: "Settings…", accelerator: "CommandOrControl+,", registerAccelerator: false, click: openSettings },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  };
}

/**
 * macOS File menu: Close Window takes Ghostty's Cmd+Shift+W. Cmd+W belongs to the page, which closes the focused pane,
 * the tab with the last one, or Settings, and closes the window only when there is nothing else to close.
 */
const MAC_FILE_MENU: MenuItemConstructorOptions = {
  label: "File",
  submenu: [
    { label: "Close Window", accelerator: "CommandOrControl+Shift+W", click: (_item, window) => window?.close() },
  ],
};

/**
 * The standard View menu, except that its zoom items zoom the whole window through the app (saved for the next launch)
 * and show their shortcuts without registering them: the page's keymap owns those keys and zooms the same way, so a
 * key press never reaches Chromium's separate page zoom.
 */
function viewMenu(zoomWindow: (step: ZoomStep) => void): MenuItemConstructorOptions {
  const zoomItem = (id: string, label: string, accelerator: string, step: ZoomStep): MenuItemConstructorOptions => ({
    id,
    label,
    accelerator,
    registerAccelerator: false,
    click: () => zoomWindow(step),
  });
  return {
    label: "View",
    submenu: [
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
      { type: "separator" },
      zoomItem("zoom-reset", "Actual Size", "CommandOrControl+0", "reset"),
      zoomItem("zoom-in", "Zoom In", "CommandOrControl+Plus", "in"),
      zoomItem("zoom-out", "Zoom Out", "CommandOrControl+-", "out"),
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
  };
}

/** Standard roles carry the platform's own labels and keyboard shortcuts. */
export function menuTemplate(options: MenuOptions): MenuItemConstructorOptions[] {
  const mac = options.platform === "darwin";
  const common: MenuItemConstructorOptions[] = [
    mac ? MAC_FILE_MENU : { role: "fileMenu" },
    { role: "editMenu" },
    shellMenu(options.platform, options.keys, options.runAction),
    viewMenu(options.zoomWindow),
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [{ label: "doriface on GitHub", click: () => options.openExternal(REPOSITORY_URL) }],
    },
  ];
  return mac ? [appMenu(options.openSettings), ...common] : common;
}
