/** IPC channels between the preload and the main process. */
export const Channel = {
  openExternal: "doriface:open-external",
  startLocalHost: "doriface:start-local-host",
  setWindowBackground: "doriface:set-window-background",
  closeWindow: "doriface:close-window",
  /** Main to renderer: show an app path in the one window (the app menu, a new-window click). */
  navigate: "doriface:navigate",
  /** Main to renderer: a pairing link is waiting; it carries no data. */
  pairingLinkWaiting: "doriface:pairing-link-waiting",
  /** Renderer to main: hands over the waiting pairing link's fragment once, or null. */
  takePairingLink: "doriface:take-pairing-link",
} as const;

/** The main process hands the app version to the sandboxed preload through this argv entry. */
export const VERSION_ARG = "--doriface-app-version=";

export type DesktopPlatform = "darwin" | "linux" | "win32";

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
  /** Calls `listener` with each pairing link fragment the app is opened with (a doriface: link or an in-app click). */
  onPairingLink(listener: (fragment: string) => void): void;
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
