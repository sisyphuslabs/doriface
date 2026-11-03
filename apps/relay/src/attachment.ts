/** Per-socket state, kept in the socket attachment so it survives hibernation. */
export type HostState = "challenged" | "verifying" | "online" | "replaced";

export interface HostAttachment {
  readonly role: "host";
  readonly hostId: string;
  readonly challenge: Uint8Array;
  readonly state: HostState;
  /** Set once the host has proved it holds the key. */
  readonly signPub?: Uint8Array | undefined;
}

export interface ClientAttachment {
  readonly role: "client";
  readonly sessionId: number;
  /** The relay or the host already ended this session, so its close is not reported to the host again. */
  readonly ended: boolean;
}

export type Attachment = HostAttachment | ClientAttachment;

const HOST_STATES: ReadonlySet<unknown> = new Set(["challenged", "verifying", "online", "replaced"]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function parse(value: unknown): Attachment | undefined {
  if (!isRecord(value)) return undefined;
  const { role } = value;
  if (role === "host") {
    const { hostId, challenge, state, signPub } = value;
    if (typeof hostId !== "string" || !(challenge instanceof Uint8Array) || !HOST_STATES.has(state)) {
      return undefined;
    }
    if (signPub !== undefined && !(signPub instanceof Uint8Array)) return undefined;
    const known = state === "challenged" || state === "verifying" || state === "online" ? state : "replaced";
    return { role, hostId, challenge, state: known, signPub };
  }
  if (role === "client") {
    const { sessionId, ended } = value;
    if (typeof sessionId !== "number" || typeof ended !== "boolean") return undefined;
    return { role, sessionId, ended };
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
