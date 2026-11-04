import type { MenuItemConstructorOptions } from "electron";
import type { DesktopPlatform, ZoomStep } from "../shared/bridge.ts";

export const REPOSITORY_URL = "https://github.com/sisyphuslabs/doriface";

export interface MenuOptions {
  readonly platform: DesktopPlatform;
  readonly openExternal: (url: string) => void;
  readonly openSettings: () => void;
  readonly zoomWindow: (step: ZoomStep) => void;
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
 * macOS File menu: Close Window shows Cmd+W without registering it, so the key reaches the page first; the page closes
 * the current tab or Settings with it and closes the window only when there is nothing else to close.
 */
const MAC_FILE_MENU: MenuItemConstructorOptions = {
  label: "File",
  submenu: [
    {
      label: "Close Window",
      accelerator: "CommandOrControl+W",
      registerAccelerator: false,
      click: (_item, window) => window?.close(),
    },
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
    viewMenu(options.zoomWindow),
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [{ label: "doriface on GitHub", click: () => options.openExternal(REPOSITORY_URL) }],
    },
  ];
  return mac ? [appMenu(options.openSettings), ...common] : common;
}
