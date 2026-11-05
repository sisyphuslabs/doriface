/** IPC channels between the preload and the main process. */
export const Channel = {
  openExternal: "doriface:open-external",
  /** A link a terminal printed, opened in the system browser (http, https, mailto). */
  openLink: "doriface:open-link",
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

/**
 * Why this computer's host did not start. `code` is doriface-host's own startup error code (`hc-binary-missing`,
 * `hc-version-failed`, `port-in-use`, `permission-denied`, `already-running`, `startup-failed`), or the shell's:
 * `host-exited` (it exited without one), `host-timeout`, `host-spawn-failed` (doriface-host itself could not run).
 */
export interface LocalHostFailure {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly address?: string;
  /** The host's own output, for a Details disclosure; never its usage text. */
  readonly details: string;
}

/** A failed start crosses IPC as a value: Electron hands the renderer only the message of a thrown error. */
export interface LocalHostStartFailed {
  readonly failure: LocalHostFailure;
}

/** What the desktop shell exposes to the renderer as `window.doriface`. */
export interface DorifaceBridge {
  readonly version: string;
  readonly platform: DesktopPlatform;
  /** Opens an allowlisted https link in the system browser; resolves false when the link is refused. */
  openExternal(url: string): Promise<boolean>;
  /** Opens a link a terminal printed in the system browser; resolves false when its scheme may not open. */
  openLink(url: string): Promise<boolean>;
  /** Starts (or reuses) doriface-host + hc on this machine; resolves with why it did not start otherwise. */
  startLocalHost(): Promise<LocalHostEndpoint | LocalHostStartFailed>;
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
}

export function parsePlatform(value: string): DesktopPlatform {
  if (value === "darwin" || value === "linux" || value === "win32") return value;
  throw new Error(`unsupported platform ${value}`);
}

const optionalString = (value: object, key: string): boolean => {
  const field: unknown = Reflect.get(value, key);
  return field === undefined || typeof field === "string";
};

export function isLocalHostStartFailed(value: unknown): value is LocalHostStartFailed {
  if (typeof value !== "object" || value === null) return false;
  const failure: unknown = Reflect.get(value, "failure");
  return (
    typeof failure === "object" &&
    failure !== null &&
    typeof Reflect.get(failure, "code") === "string" &&
    typeof Reflect.get(failure, "message") === "string" &&
    typeof Reflect.get(failure, "details") === "string" &&
    optionalString(failure, "path") &&
    optionalString(failure, "address")
  );
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
