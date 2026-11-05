export type ConnectionMode = "relay" | "loopback";

export interface ConnectionSettings {
  readonly mode: ConnectionMode;
  /** Base URL of the relay; the client path is appended. */
  readonly relayUrl: string;
  /** The host's LAN origin for the direct /v1/e2ee race, when known. */
  readonly directUrl: string;
  /** The paired host to reach over the relay or directly. */
  readonly hostId: string;
  /** base64url of the paired host's Noise static key, which every IK handshake to it needs. */
  readonly hostKey: string;
  /** Loopback dev: the host's plaintext /v1/hc WebSocket URL and its token. */
  readonly loopbackUrl: string;
  readonly token: string;
}

export const DEFAULT_RELAY_URL = "wss://relay-doriface.omo.dev";

export const DEFAULT_SETTINGS: ConnectionSettings = {
  mode: "relay",
  relayUrl: DEFAULT_RELAY_URL,
  directUrl: "",
  hostId: "",
  hostKey: "",
  loopbackUrl: "ws://127.0.0.1:7766/v1/hc",
  token: "",
};

const KEY = "doriface.connection";

/** Whether this is a dev build (vite dev): only a dev build may name another relay or switch to the loopback gateway. */
export const DEV_BUILD: boolean = import.meta.env.DEV === true;

/** The settings a build may use: a release build always reaches the production relay, whatever relay was saved. */
export function lockRelay(settings: ConnectionSettings, devBuild: boolean = DEV_BUILD): ConnectionSettings {
  return devBuild || settings.relayUrl === DEFAULT_RELAY_URL ? settings : { ...settings, relayUrl: DEFAULT_RELAY_URL };
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Reads stored settings; anything malformed falls back field by field to the defaults, and a release build drops a saved
 * custom relay address. With no localStorage at all (bun's test runner, which loads store.ts and with it this read), the
 * defaults: reading the global at module load must not depend on which test file installed one first (#490).
 */
export function loadSettings(
  storage: Storage | undefined = Reflect.get(globalThis, "localStorage") as Storage | undefined,
  { devBuild = DEV_BUILD }: { readonly devBuild?: boolean } = {},
): ConnectionSettings {
  if (storage === undefined) return DEFAULT_SETTINGS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(KEY) ?? "null");
  } catch {
    parsed = null;
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_SETTINGS;
  const get = (key: string): unknown => (Object.hasOwn(parsed, key) ? Reflect.get(parsed, key) : undefined);
  const d = DEFAULT_SETTINGS;
  return lockRelay(
    {
      mode: get("mode") === "loopback" ? "loopback" : "relay",
      relayUrl: text(get("relayUrl"), d.relayUrl),
      directUrl: text(get("directUrl"), d.directUrl),
      hostId: text(get("hostId"), d.hostId),
      hostKey: text(get("hostKey"), d.hostKey),
      loopbackUrl: text(get("loopbackUrl"), d.loopbackUrl),
      token: text(get("token"), d.token),
    },
    devBuild,
  );
}

export function saveSettings(settings: ConnectionSettings, storage: Storage = localStorage): void {
  storage.setItem(KEY, JSON.stringify(settings));
}

/**
 * Whether the link stays on this computer (the loopback gateway on 127.0.0.1, localhost or ::1), so a lost network
 * says nothing about it: the desktop app's "This computer" keeps working with Wi-Fi off.
 */
export function staysOnThisComputer(settings: ConnectionSettings): boolean {
  if (settings.mode !== "loopback") return false;
  let host: string;
  try {
    host = new URL(settings.loopbackUrl).hostname;
  } catch {
    return false;
  }
  return host === "localhost" || host === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/** Whether these settings name something to connect to. */
export function isConfigured(settings: ConnectionSettings): boolean {
  return settings.mode === "loopback"
    ? settings.token !== "" && settings.loopbackUrl !== ""
    : settings.hostId !== "" && settings.hostKey !== "";
}
