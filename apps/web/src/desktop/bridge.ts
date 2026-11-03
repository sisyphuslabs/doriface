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

/** Runs `open` whenever the desktop app menu's Settings… item is chosen; does nothing outside the desktop app. */
export function onDesktopOpenSettings(open: () => void, scope: object = globalThis): void {
  const bridge: unknown = Reflect.get(scope, "doriface");
  if (typeof bridge !== "object" || bridge === null) return;
  const subscribe: unknown = Reflect.get(bridge, "onOpenSettings");
  if (typeof subscribe === "function") Reflect.apply(subscribe, bridge, [() => open()]);
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
