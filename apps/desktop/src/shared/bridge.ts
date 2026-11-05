/** IPC channels between the preload and the main process. */
export const Channel = {
  openExternal: "doriface:open-external",
  /** A link a terminal printed, opened in the system browser (http, https, mailto). */
  openLink: "doriface:open-link",
  startLocalHost: "doriface:start-local-host",
  setWindowBackground: "doriface:set-window-background",
  closeWindow: "doriface:close-window",
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
  /** Renderer to main: pick herdr-core's hc in a file dialog and keep it for every later start. */
  chooseHc: "doriface:choose-hc",
  /** Main to renderer: an update is downloaded and staged; it carries no data. */
  updateReady: "doriface:update-ready",
  /** Renderer to main: the staged update, or null. */
  takeUpdate: "doriface:take-update",
  /** Renderer to main: quit and install the staged update (Restart to update). */
  installUpdate: "doriface:install-update",
  /** Renderer to main: download, verify and install herdr-core for this user (Install herdr-core). */
  installHc: "doriface:install-hc",
  /** Main to renderer: the phase an Install herdr-core has reached, e.g. `download`. */
  hcInstallPhase: "doriface:hc-install-phase",
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
  /** For `hc-version-failed`: the version of an hc older than doriface-host supports. */
  readonly version?: string;
  /** For `hc-binary-missing`: the folders searched for hc after PATH, on this platform. */
  readonly searched?: readonly string[];
  /** The host's own output, for a Details disclosure; never its usage text. */
  readonly details: string;
}

/** A release the updater downloaded and staged: Restart to update installs it. */
export interface UpdateReady {
  readonly version: string;
}

export const isUpdateReady = (value: unknown): value is UpdateReady =>
  typeof value === "object" && value !== null && typeof Reflect.get(value, "version") === "string";

/** What Install herdr-core answers: the installed version and binary, or why it failed (as a value, like a start). */
export type HcInstallAnswer =
  | { readonly installed: { readonly version: string; readonly path: string } }
  | { readonly failed: { readonly phase: string; readonly message: string } };

const strings = (part: unknown, keys: readonly string[]): boolean =>
  typeof part === "object" && part !== null && keys.every((key) => typeof Reflect.get(part, key) === "string");

export function isHcInstallAnswer(value: unknown): value is HcInstallAnswer {
  if (typeof value !== "object" || value === null) return false;
  const installed: unknown = Reflect.get(value, "installed");
  const failed: unknown = Reflect.get(value, "failed");
  return strings(installed, ["version", "path"]) || strings(failed, ["phase", "message"]);
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
  /** Calls `listener` with each pairing link fragment the app is opened with (a doriface: link or an in-app click). */
  onPairingLink(listener: (fragment: string) => void): void;
  /** Calls `listener` with each action id a Shell menu item asks the page to run. */
  onRunAction(listener: (action: string) => void): void;
  /** Tells the menu the page's trigger (Ghostty syntax) for each of its actions. */
  setMenuKeys(keys: Readonly<Record<string, string>>): Promise<boolean>;
  /** Asks for herdr-core's hc in a file dialog and keeps it; resolves with its path, or null when cancelled. */
  chooseHc(): Promise<string | null>;
  /** Downloads, verifies and installs herdr-core for this user, calling `onPhase` as it goes; later starts use it. */
  installHc(onPhase: (phase: string) => void): Promise<HcInstallAnswer>;
  /** Calls `listener` once an update is staged, at once when one already is. */
  onUpdateReady(listener: (update: UpdateReady) => void): void;
  /** Quits and installs the staged update; resolves false when none is staged. */
  installUpdate(): Promise<boolean>;
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
    optionalString(failure, "address") &&
    optionalString(failure, "version")
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
