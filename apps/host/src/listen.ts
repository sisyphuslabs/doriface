export interface ListenAddress {
  readonly hostname: string;
  readonly port: number;
}

/** Parses `host:port`, `[v6]:port` or a bare `:port` (which means 127.0.0.1). */
export function parseListen(value: string, option = "--listen"): ListenAddress {
  const match = /^(?:\[([^\]]+)\]|([^:]*)):(\d{1,5})$/.exec(value);
  const port = Number(match?.[3]);
  if (match === null || !Number.isInteger(port) || port > 65_535) {
    throw new Error(`${option} wants host:port, got ${JSON.stringify(value)}`);
  }
  return { hostname: match[1] ?? (match[2] === "" || match[2] === undefined ? "127.0.0.1" : match[2]), port };
}

export function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "::1" || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

export function formatHost(hostname: string): string {
  return hostname.includes(":") ? `[${hostname}]` : hostname;
}
