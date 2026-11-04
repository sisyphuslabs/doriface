/**
 * The desktop shell's `window.doriface`, mirrored from apps/desktop/src/shared/bridge.ts (DorifaceBridge,
 * LocalHostEndpoint). The web app reads it at runtime as an untrusted boundary, so it checks the shape.
 */
export interface LocalHostEndpoint {
  readonly url: string;
  readonly token: string;
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
      const endpoint: unknown = await Reflect.apply(start, bridge, []);
      if (!isEndpoint(endpoint)) throw new Error("the desktop app returned no local host address");
      return endpoint;
    },
  };
}
