/**
 * The desktop shell's `window.doriface`, mirrored from apps/desktop/src/shared/bridge.ts (DorifaceBridge,
 * LocalHostEndpoint, LocalHostFailure). The web app reads it at runtime as an untrusted boundary, so it checks the shape.
 */
export interface LocalHostEndpoint {
  readonly url: string;
  readonly token: string;
}

/** Why this computer's host did not start; `details` is its raw output, shown only on request. */
export interface HostStartFailure {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly address?: string;
  readonly details: string;
}

export class HostStartError extends Error {
  override readonly name = "HostStartError";
  readonly failure: HostStartFailure;

  constructor(failure: HostStartFailure) {
    super(failure.message);
    this.failure = failure;
  }
}

const optionalString = (value: object, key: string): string | undefined | null => {
  const field: unknown = Reflect.get(value, key);
  return field === undefined || typeof field === "string" ? field : null;
};

/** The failure in a `{ failure }` answer, or undefined when the answer is not one. */
function failureOf(value: unknown): HostStartFailure | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const failure: unknown = Reflect.get(value, "failure");
  if (typeof failure !== "object" || failure === null) return undefined;
  const code: unknown = Reflect.get(failure, "code");
  const message: unknown = Reflect.get(failure, "message");
  const details: unknown = Reflect.get(failure, "details");
  const path = optionalString(failure, "path");
  const address = optionalString(failure, "address");
  if (typeof code !== "string" || typeof message !== "string" || typeof details !== "string") return undefined;
  if (path === null || address === null) return undefined;
  return {
    code,
    message,
    details,
    ...(path === undefined ? {} : { path }),
    ...(address === undefined ? {} : { address }),
  };
}

export interface DesktopBridge {
  startLocalHost(): Promise<LocalHostEndpoint>;
}

function isEndpoint(value: unknown): value is LocalHostEndpoint {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "url") === "string" &&
    typeof Reflect.get(value, "token") === "string"
  );
}

/** The desktop shell's method `name`, or null outside the desktop app or in a build without it. */
function bridgeMethod(name: string, scope: object): ((...args: unknown[]) => unknown) | null {
  const bridge: unknown = Reflect.get(scope, "doriface");
  if (typeof bridge !== "object" || bridge === null) return null;
  const method: unknown = Reflect.get(bridge, name);
  return typeof method === "function" ? (...args) => Reflect.apply(method, bridge, args) : null;
}

const isAppPath = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith("/") && !value.startsWith("//");

/** Shows each app path the desktop shell asks for (its app menu, a new-window click) with `show`. */
export function onDesktopNavigate(show: (path: string) => void, scope: object = globalThis): void {
  bridgeMethod(
    "onNavigate",
    scope,
  )?.((path: unknown) => {
    if (isAppPath(path)) show(path);
  });
}

/** Asks the desktop shell to close the window; false outside the desktop app. */
export function closeDesktopWindow(scope: object = globalThis): boolean {
  const close = bridgeMethod("closeWindow", scope);
  if (close === null) return false;
  const closed = close();
  if (closed instanceof Promise) closed.catch((error: unknown) => console.error(`close window: ${String(error)}`));
  return true;
}

export type ZoomStep = "in" | "out" | "reset";

/** Asks the desktop shell to zoom its whole window one step; false outside the desktop app. */
export function zoomDesktopWindow(step: ZoomStep, scope: object = globalThis): boolean {
  const zoom = bridgeMethod("zoomWindow", scope);
  if (zoom === null) return false;
  const zoomed = zoom(step);
  if (zoomed instanceof Promise) zoomed.catch((error: unknown) => console.error(`zoom window: ${String(error)}`));
  return true;
}

/** Hands the page background to the desktop shell, which paints the window with it now and at the next launch. */
export function setDesktopBackground(color: string, scope: object = globalThis): void {
  const painted = bridgeMethod("setWindowBackground", scope)?.(color);
  if (painted instanceof Promise)
    painted.catch((error: unknown) => console.error(`window background: ${String(error)}`));
}

/** Runs `open` with each pairing link fragment the desktop app hands over; does nothing outside the desktop app. */
export function onDesktopPairingLink(open: (fragment: string) => void, scope: object = globalThis): void {
  bridgeMethod(
    "onPairingLink",
    scope,
  )?.((fragment: unknown) => {
    if (typeof fragment === "string") open(fragment);
  });
}

/** Runs each action a desktop menu item asks for, as its key would; does nothing outside the desktop app. */
export function onDesktopRunAction(run: (action: string) => void, scope: object = globalThis): void {
  bridgeMethod(
    "onRunAction",
    scope,
  )?.((action: unknown) => {
    if (typeof action === "string") run(action);
  });
}

/** Tells the desktop menu the keymap's trigger for each action it lists, so its shortcuts follow the person's keys. */
export function setDesktopMenuKeys(keys: Readonly<Record<string, string>>, scope: object = globalThis): void {
  const shown = bridgeMethod("setMenuKeys", scope)?.(keys);
  if (shown instanceof Promise) shown.catch((error: unknown) => console.error(`menu shortcuts: ${String(error)}`));
}

export function desktopBridge(scope: object = globalThis): DesktopBridge | null {
  const bridge: unknown = Reflect.get(scope, "doriface");
  if (typeof bridge !== "object" || bridge === null) return null;
  const start: unknown = Reflect.get(bridge, "startLocalHost");
  if (typeof start !== "function") return null;
  return {
    startLocalHost: async () => {
      const answer: unknown = await Reflect.apply(start, bridge, []);
      const failure = failureOf(answer);
      if (failure !== undefined) throw new HostStartError(failure);
      if (!isEndpoint(answer)) throw new Error("the desktop app returned no local host address");
      return answer;
    },
  };
}
