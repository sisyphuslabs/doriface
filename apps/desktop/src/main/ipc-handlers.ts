import { allowedExternal } from "../config/external.ts";
import { terminalLinkTarget } from "../config/terminal-link.ts";
import { isHexColour } from "../config/window.ts";
import { isSameOrigin } from "../config/origin.ts";
import {
  isZoomStep,
  type LocalHostEndpoint,
  type LocalHostStartFailed,
  type UpdateReady,
  type ZoomStep,
} from "../shared/bridge.ts";
import { LocalHostStartError } from "./local-host.ts";
import { SHELL_MENU_ACTIONS } from "./shell-menu.ts";

/** The part of an IPC event the gate reads; `senderFrame` is null once the frame is gone. */
export interface IpcSender {
  readonly senderFrame: { readonly url: string } | null;
}

export interface IpcDeps {
  readonly origin: string;
  readonly startLocalHost: () => Promise<LocalHostEndpoint>;
  readonly openExternal: (url: string) => Promise<void>;
  readonly setWindowBackground: (color: string) => void;
  readonly closeWindow: () => void;
  readonly zoomWindow: (step: ZoomStep) => void;
  readonly takePairingLink: () => string | undefined;
  readonly setMenuKeys: (keys: ReadonlyMap<string, string>) => void;
  /** Shows the file dialog for hc and keeps the choice; undefined when it was cancelled. */
  readonly chooseHc: () => Promise<string | undefined>;
  readonly takeUpdate: () => UpdateReady | null;
  /** Quits and installs the staged update; false when none is staged. */
  readonly installUpdate: () => boolean;
}

export interface IpcHandlers {
  openExternal(event: IpcSender, candidate: unknown): Promise<boolean>;
  /** A link a terminal printed: any host, but only http, https and mailto (`terminalLinkTarget`). */
  openLink(event: IpcSender, candidate: unknown): Promise<boolean>;
  startLocalHost(event: IpcSender): Promise<LocalHostEndpoint | LocalHostStartFailed>;
  /** Paints the window and the next launch with the in-app theme's background; only `#rrggbb` is taken. */
  setWindowBackground(event: IpcSender, candidate: unknown): Promise<boolean>;
  /** Closes the window the way its Close Window item does, so the close events (and the saved placement) run. */
  closeWindow(event: IpcSender): Promise<void>;
  /** Zooms the window one step, as its View menu does; anything but `in`, `out` or `reset` is refused. */
  zoomWindow(event: IpcSender, candidate: unknown): Promise<boolean>;
  takePairingLink(event: IpcSender): string | null;
  /** Shows the page's shortcuts in the Shell menu; only its own action ids and short trigger text are taken. */
  setMenuKeys(event: IpcSender, candidate: unknown): Promise<boolean>;
  /** Choose hc: the chosen file's path, or null when the dialog was cancelled. */
  chooseHc(event: IpcSender): Promise<string | null>;
  /** The staged update, or null. */
  takeUpdate(event: IpcSender): UpdateReady | null;
  /** Restart to update: false when no update is staged. */
  installUpdate(event: IpcSender): Promise<boolean>;
}

const TRIGGER = /^[a-z0-9_+=\-[\];',./`\\]{1,40}$/;

/** The entries the menu can show; one it cannot (another action, or trigger text it does not take) is left out alone. */
function menuKeys(candidate: unknown): Map<string, string> | undefined {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return undefined;
  const keys = new Map<string, string>();
  for (const [action, trigger] of Object.entries(candidate)) {
    if (SHELL_MENU_ACTIONS.has(action) && typeof trigger === "string" && TRIGGER.test(trigger))
      keys.set(action, trigger);
  }
  return keys;
}

function assertAppFrame(event: IpcSender, origin: string): void {
  const url = event.senderFrame?.url ?? "";
  if (!isSameOrigin(url, origin)) throw new Error(`refused IPC from ${url === "" ? "a detached frame" : url}`);
}

/** Every handler refuses senders outside the app origin before doing anything. */
export function ipcHandlers(deps: IpcDeps): IpcHandlers {
  return {
    async openExternal(event, candidate) {
      assertAppFrame(event, deps.origin);
      const url = typeof candidate === "string" ? allowedExternal(candidate) : undefined;
      if (url === undefined) return false;
      await deps.openExternal(url);
      return true;
    },
    async openLink(event, candidate) {
      assertAppFrame(event, deps.origin);
      const url = typeof candidate === "string" ? terminalLinkTarget(candidate) : undefined;
      if (url === undefined) return false;
      await deps.openExternal(url);
      return true;
    },
    async startLocalHost(event) {
      assertAppFrame(event, deps.origin);
      try {
        return await deps.startLocalHost();
      } catch (error) {
        if (error instanceof LocalHostStartError) return { failure: error.failure };
        throw error;
      }
    },
    async setWindowBackground(event, candidate) {
      assertAppFrame(event, deps.origin);
      if (!isHexColour(candidate)) return false;
      deps.setWindowBackground(candidate);
      return true;
    },
    async closeWindow(event) {
      assertAppFrame(event, deps.origin);
      deps.closeWindow();
    },
    async zoomWindow(event, candidate) {
      assertAppFrame(event, deps.origin);
      if (!isZoomStep(candidate)) return false;
      deps.zoomWindow(candidate);
      return true;
    },
    takePairingLink(event) {
      assertAppFrame(event, deps.origin);
      return deps.takePairingLink() ?? null;
    },
    async setMenuKeys(event, candidate) {
      assertAppFrame(event, deps.origin);
      const keys = menuKeys(candidate);
      if (keys === undefined) return false;
      deps.setMenuKeys(keys);
      return true;
    },
    async chooseHc(event) {
      assertAppFrame(event, deps.origin);
      return (await deps.chooseHc()) ?? null;
    },
    takeUpdate(event) {
      assertAppFrame(event, deps.origin);
      return deps.takeUpdate();
    },
    async installUpdate(event) {
      assertAppFrame(event, deps.origin);
      return deps.installUpdate();
    },
  };
}
