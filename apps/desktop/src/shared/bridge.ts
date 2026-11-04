/** IPC channels between the preload and the main process. */
export const Channel = {
  openExternal: "doriface:open-external",
  startLocalHost: "doriface:start-local-host",
  setWindowBackground: "doriface:set-window-background",
  closeWindow: "doriface:close-window",
  zoomWindow: "doriface:zoom-window",
  /** Main to renderer: show an app path in the one window (the app menu, a new-window click). */
  navigate: "doriface:navigate",
  /** Main to renderer: a pairing link is waiting; it carries no data. */
  pairingLinkWaiting: "doriface:pairing-link-waiting",
  /** Renderer to main: hands over the waiting pairing link's fragment once, or null. */
  takePairingLink: "doriface:take-pairing-link",
  /** Main to renderer: run one of the page's actions (a Shell menu item), e.g. `pane.split:right`. */
  runAction: "doriface:run-action",
  /** Renderer to main: the page's current trigger for each Shell menu action, so the menu shows the live shortcuts. */
  setMenuKeys: "doriface:set-menu-keys",
} as const;

/** The main process hands the app version to the sandboxed preload through this argv entry. */
export const VERSION_ARG = "--doriface-app-version=";

export type DesktopPlatform = "darwin" | "linux" | "win32";

/** One step of the window zoom, as Cmd/Ctrl + = / - / 0 and View > Zoom In / Zoom Out / Actual Size take it. */
export type ZoomStep = "in" | "out" | "reset";

export const isZoomStep = (value: unknown): value is ZoomStep => value === "in" || value === "out" || value === "reset";

export interface LocalHostEndpoint {
  /** The loopback gateway, e.g. `ws://127.0.0.1:52011/v1/hc`. */
  readonly url: string;
  /** Offered as the `doriface.token.<token>` WebSocket subprotocol after `doriface.v1`. */
  readonly token: string;
}

/** What the desktop shell exposes to the renderer as `window.doriface`. */
export interface DorifaceBridge {
  readonly version: string;
  readonly platform: DesktopPlatform;
  /** Opens an allowlisted https link in the system browser; resolves false when the link is refused. */
  openExternal(url: string): Promise<boolean>;
  /** Starts (or reuses) doriface-host + hc on this machine. */
  startLocalHost(): Promise<LocalHostEndpoint>;
  /** Calls `listener` with an app path to show, e.g. `/settings` from the app menu. */
  onNavigate(listener: (path: string) => void): void;
  /** Paints the window, now and at the next launch, with the in-app theme's background (`#rrggbb`). */
  setWindowBackground(color: string): Promise<boolean>;
  /** Closes the window as File > Close Window does; the page's own window.close() would skip the close events. */
  closeWindow(): Promise<void>;
  /** Zooms the whole window one step, as the View menu's zoom items do; the zoom is restored at the next launch. */
  zoomWindow(step: ZoomStep): Promise<void>;
  /** Calls `listener` with each pairing link fragment the app is opened with (a doriface: link or an in-app click). */
  onPairingLink(listener: (fragment: string) => void): void;
  /** Calls `listener` with each action id a Shell menu item asks the page to run. */
  onRunAction(listener: (action: string) => void): void;
  /** Tells the menu the page's trigger (Ghostty syntax) for each of its actions. */
  setMenuKeys(keys: Readonly<Record<string, string>>): Promise<boolean>;
}

export function parsePlatform(value: string): DesktopPlatform {
  if (value === "darwin" || value === "linux" || value === "win32") return value;
  throw new Error(`unsupported platform ${value}`);
}

export function isLocalHostEndpoint(value: unknown): value is LocalHostEndpoint {
  return (
    typeof value === "object" &&
    value !== null &&
    "url" in value &&
    typeof value.url === "string" &&
    "token" in value &&
    typeof value.token === "string"
  );
}
