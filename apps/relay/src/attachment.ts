/** Per-socket state, kept in the socket attachment so it survives hibernation. */
export type HostState = "challenged" | "verifying" | "online" | "replaced";

/** Bytes the relay sent on a socket and the receiver's last `a:<n>` ack (contract v1.2 C3). */
interface Flow {
  readonly sent: number;
  readonly acked: number;
  /** When the socket was accepted; the idle reaper uses it until the first pong. */
  readonly openedAt: number;
}

export interface HostAttachment extends Flow {
  readonly role: "host";
  readonly hostId: string;
  /** `wss://host[:port]` of the URL the host dialed; the challenge signature covers it (contract v1.2 C4). */
  readonly relayOrigin: string;
  readonly challenge: Uint8Array;
  readonly state: HostState;
  /** Set once the host has proved it holds the key. */
  readonly signPub?: Uint8Array | undefined;
  /** The uplink dialed with `?credit=1` (contract v1.3). */
  readonly credit?: boolean | undefined;
}

export interface ClientAttachment extends Flow {
  readonly role: "client";
  readonly sessionId: number;
  /** The relay or the host already ended this session, so its close is not reported to the host again. */
  readonly ended: boolean;
  /** Admitted but the host has not sent DATA yet (contract v1.2 C1). */
  readonly pending: boolean;
  readonly ip: string;
  /** Set for a pairing session (`?pair=<slot>`), which is charged to that slot once the host answers it. */
  readonly pairSlot?: string | undefined;
  /** Both ends asked for session credit (contract v1.3), so the host's CREDIT reaches this client as `c:<n>`. */
  readonly credit?: boolean | undefined;
  /** Session bytes forwarded to a credit host, and how many of them it has credited back. */
  readonly toHost?: number | undefined;
  readonly hostCredited?: number | undefined;
}

export type Attachment = HostAttachment | ClientAttachment;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function hostState(value: unknown): HostState | undefined {
  return value === "challenged" || value === "verifying" || value === "online" || value === "replaced"
    ? value
    : undefined;
}

const counted = (count: unknown): number => (typeof count === "number" ? count : 0);

function parseFlow(value: Readonly<Record<string, unknown>>): Flow | undefined {
  const { sent, acked, openedAt } = value;
  if (typeof sent !== "number" || typeof acked !== "number" || typeof openedAt !== "number") return undefined;
  return { sent, acked, openedAt };
}

function parse(value: unknown): Attachment | undefined {
  if (!isRecord(value)) return undefined;
  const flow = parseFlow(value);
  if (flow === undefined) return undefined;
  const { role } = value;
  if (role === "host") {
    const { hostId, relayOrigin, challenge, signPub, credit, state: rawState } = value;
    const state = hostState(rawState);
    if (typeof hostId !== "string" || typeof relayOrigin !== "string") return undefined;
    if (!(challenge instanceof Uint8Array) || state === undefined) return undefined;
    if (signPub !== undefined && !(signPub instanceof Uint8Array)) return undefined;
    return { ...flow, role, hostId, relayOrigin, challenge, state, signPub, credit: credit === true };
  }
  if (role === "client") {
    const { sessionId, ended, pending, ip, pairSlot, credit, toHost, hostCredited } = value;
    if (typeof sessionId !== "number" || typeof ended !== "boolean") return undefined;
    if (typeof pending !== "boolean" || typeof ip !== "string") return undefined;
    if (pairSlot !== undefined && typeof pairSlot !== "string") return undefined;
    return {
      ...flow,
      role,
      sessionId,
      ended,
      pending,
      ip,
      pairSlot,
      credit: credit === true,
      toHost: counted(toHost),
      hostCredited: counted(hostCredited),
    };
  }
  return undefined;
}

export function attachmentOf(ws: WebSocket): Attachment | undefined {
  const value: unknown = ws.deserializeAttachment();
  return parse(value);
}

export function attach(ws: WebSocket, attachment: Attachment): void {
  ws.serializeAttachment(attachment);
}

/** Applies `change` to the socket's current host attachment, so a field updated meanwhile is never rolled back. */
export function patchHost(ws: WebSocket, change: Partial<Omit<HostAttachment, "role">>): HostAttachment | undefined {
  const current = attachmentOf(ws);
  if (current?.role !== "host") return undefined;
  const next = { ...current, ...change };
  attach(ws, next);
  return next;
}

export function patchClient(
  ws: WebSocket,
  change: Partial<Omit<ClientAttachment, "role">>,
): ClientAttachment | undefined {
  const current = attachmentOf(ws);
  if (current?.role !== "client") return undefined;
  const next = { ...current, ...change };
  attach(ws, next);
  return next;
}
