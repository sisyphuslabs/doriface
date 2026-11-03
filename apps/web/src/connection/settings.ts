export type ConnectionMode = "relay" | "loopback";

export interface ConnectionSettings {
  readonly mode: ConnectionMode;
  /** Base URL of the relay; the client path is appended. */
  readonly relayUrl: string;
  /** The host's LAN origin for the direct /v1/e2ee race, when known. */
  readonly directUrl: string;
  /** The paired host to reach over the relay or directly. */
  readonly hostId: string;
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
  loopbackUrl: "ws://127.0.0.1:7766/v1/hc",
  token: "",
};

const KEY = "doriface.connection";

function text(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/** Reads stored settings; anything malformed falls back field by field to the defaults. */
export function loadSettings(storage: Storage = localStorage): ConnectionSettings {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(KEY) ?? "null");
  } catch {
    parsed = null;
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_SETTINGS;
  const get = (key: string): unknown => (Object.hasOwn(parsed, key) ? Reflect.get(parsed, key) : undefined);
  const d = DEFAULT_SETTINGS;
  return {
    mode: get("mode") === "loopback" ? "loopback" : "relay",
    relayUrl: text(get("relayUrl"), d.relayUrl),
    directUrl: text(get("directUrl"), d.directUrl),
    hostId: text(get("hostId"), d.hostId),
    loopbackUrl: text(get("loopbackUrl"), d.loopbackUrl),
    token: text(get("token"), d.token),
  };
}

export function saveSettings(settings: ConnectionSettings, storage: Storage = localStorage): void {
  storage.setItem(KEY, JSON.stringify(settings));
}

/** Whether these settings name something to connect to. */
export function isConfigured(settings: ConnectionSettings): boolean {
  return settings.mode === "loopback" ? settings.token !== "" && settings.loopbackUrl !== "" : settings.hostId !== "";
}

export function relayClientUrl(settings: ConnectionSettings): string {
  return `${settings.relayUrl.replace(/\/+$/, "")}/v1/client/${settings.hostId}`;
}
