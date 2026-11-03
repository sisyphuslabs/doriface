import {
  CHALLENGE_BYTES,
  CloseCode,
  decodeMux,
  encodeClose,
  encodeData,
  encodeOpen,
  HOST_ID_PATTERN,
  MAX_SESSION_SEND_BYTES,
  MuxError,
  MuxType,
  PING,
  PONG,
  RELAY_MESSAGE_CAP,
  relayOriginOf,
  sendableCloseCode,
} from "@doriface/relay-client/wire";
import { DurableObject } from "cloudflare:workers";
import { evictionVictim, MAX_ACTIVE_SESSIONS, MAX_PENDING_SESSIONS } from "./admission.ts";
import {
  attach,
  type ClientAttachment,
  type HostAttachment,
  attachmentOf,
  patchClient,
  patchHost,
} from "./attachment.ts";
import { verifyAuthAnswer } from "./auth.ts";
import { applyAck, forward, sendControl } from "./flow.ts";
import { AUTH_TIMEOUT_MS, sourceOf } from "./limits.ts";
import type { PairSlotsEnv } from "./pair-slot.ts";
import { handlePairSlot } from "./pairing.ts";
import { alarmBy, overdue, type TimeoutVars, timeoutsOf } from "./reaper.ts";
import { closedSocket } from "./reject.ts";
import {
  CLIENT_TAG,
  clientSocket,
  closeIfOpen,
  completeClose,
  freshSessionId,
  HOST_TAG,
  isOpen,
  liveClients,
  newSocketPair,
  onlineHost,
  sessionTag,
  withAttachment,
} from "./sockets.ts";

export interface RoomEnv extends PairSlotsEnv, TimeoutVars {}

/**
 * One room per hostId: the host's uplink and every client session to it. All state lives in socket attachments,
 * so the object can hibernate between messages. Payloads are forwarded as they arrive and never inspected.
 */
export class Room extends DurableObject<RoomEnv> {
  /** Hosts that have not finished the challenge yet; a client arriving meanwhile waits for them to settle. */
  readonly #authenticating = new Map<WebSocket, PromiseWithResolvers<void>>();

  constructor(ctx: DurableObjectState, env: RoomEnv) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const [, , role, hostId = ""] = url.pathname.split("/");
    if (!HOST_ID_PATTERN.test(hostId)) return new Response("bad hostId", { status: 400 });
    if (role === "host") return this.#acceptHost(hostId, relayOriginOf(request.url));
    if (role !== "client") return new Response("not found", { status: 404 });
    if ((await this.#settledHost()) === undefined) return closedSocket(CloseCode.HostOffline, "host offline");
    const pairSlot = url.searchParams.get("pair");
    if (pairSlot !== null) {
      const slots = this.env.PAIR_SLOTS;
      const verdict = await slots.get(slots.idFromName(pairSlot)).admitOpen(hostId);
      if (verdict === "not-held") return closedSocket(CloseCode.HostOffline, "no host is pairing on this slot");
      if (verdict === "limited") return closedSocket(CloseCode.RateLimited, "pairing budget spent for this slot");
    }
    return this.#acceptClient(sourceOf(request));
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = attachmentOf(ws);
    if (attachment === undefined) return ws.close(CloseCode.InternalError, "unknown socket");
    if (typeof message === "string") {
      if (!applyAck(ws, message)) ws.close(CloseCode.UnsupportedData, "binary messages, pings and acks only");
      return;
    }
    // A client's message becomes an uplink frame with a 5-byte header, which must fit the same 1 MiB cap.
    const cap = attachment.role === "client" ? MAX_SESSION_SEND_BYTES : RELAY_MESSAGE_CAP;
    if (message.byteLength > cap) return ws.close(CloseCode.MessageTooBig, "message too big");
    const bytes = new Uint8Array(message);
    if (attachment.role === "client") return this.#fromClient(ws, attachment, bytes);
    if (attachment.state === "online") return this.#fromHost(ws, attachment, bytes);
    return this.#authenticate(ws, attachment, bytes);
  }

  override webSocketClose(ws: WebSocket, code: number): void {
    this.#closed(ws, code);
  }

  override webSocketError(ws: WebSocket): void {
    this.#closed(ws, CloseCode.InternalError);
  }

  override async alarm(): Promise<void> {
    const { expired, next } = overdue(this.ctx, timeoutsOf(this.env), Date.now());
    for (const { ws, attachment, reason } of expired) {
      if (attachment.role === "client") this.#endSession(ws, attachment, CloseCode.IdleTimeout, reason);
      else if (attachment.state === "online") this.#dropHost(ws, CloseCode.IdleTimeout, reason);
      // A socket that never became (or no longer is) the uplink owns no sessions.
      else closeIfOpen(ws, CloseCode.IdleTimeout, reason);
    }
    if (next !== undefined) await this.ctx.storage.setAlarm(next);
  }

  async #acceptHost(hostId: string, relayOrigin: string): Promise<Response> {
    const { client, server } = newSocketPair();
    this.ctx.acceptWebSocket(server, [HOST_TAG]);
    const challenge = crypto.getRandomValues(new Uint8Array(CHALLENGE_BYTES));
    const openedAt = Date.now();
    attach(server, { role: "host", hostId, relayOrigin, challenge, state: "challenged", sent: 0, acked: 0, openedAt });
    this.#authenticating.set(server, Promise.withResolvers());
    setTimeout(() => {
      if (!this.#authenticating.has(server)) return;
      closeIfOpen(server, CloseCode.RelayAuthFailed, "relay auth timed out");
      this.#settle(server);
    }, AUTH_TIMEOUT_MS);
    sendControl(server, challenge);
    await alarmBy(this.ctx, openedAt + timeoutsOf(this.env).idleMs);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** The online host, after waiting out any host still answering its challenge (bounded by the auth timeout). */
  async #settledHost(): Promise<WebSocket | undefined> {
    const host = onlineHost(this.ctx);
    if (host !== undefined || this.#authenticating.size === 0) return host;
    await Promise.race([...this.#authenticating.values()].map(({ promise }) => promise));
    return this.#settledHost();
  }

  #settle(ws: WebSocket): void {
    this.#authenticating.get(ws)?.resolve();
    this.#authenticating.delete(ws);
  }

  /** Admits a session as pending (contract v1.2 C1); it counts against the 32 only once the host sends DATA. */
  async #acceptClient(ip: string): Promise<Response> {
    const host = onlineHost(this.ctx);
    if (host === undefined) return closedSocket(CloseCode.HostOffline, "host offline");
    const live = liveClients(this.ctx);
    const pending = live.filter(({ attachment }) => attachment.pending);
    if (live.length - pending.length >= MAX_ACTIVE_SESSIONS) {
      return closedSocket(CloseCode.RateLimited, "too many sessions for this host");
    }
    if (pending.length >= MAX_PENDING_SESSIONS) {
      const victim = evictionVictim(pending, ({ attachment }) => attachment);
      if (victim !== undefined) {
        this.#endSession(victim.ws, victim.attachment, CloseCode.RateLimited, "too many pending sessions");
      }
    }
    const sessionId = freshSessionId(this.ctx);
    const { client, server } = newSocketPair();
    this.ctx.acceptWebSocket(server, [CLIENT_TAG, sessionTag(sessionId)]);
    const openedAt = Date.now();
    attach(server, { role: "client", sessionId, ended: false, pending: true, ip, sent: 0, acked: 0, openedAt });
    sendControl(host, encodeOpen(sessionId));
    await alarmBy(this.ctx, openedAt + timeoutsOf(this.env).pendingMs);
    return new Response(null, { status: 101, webSocket: client });
  }

  async #authenticate(ws: WebSocket, attachment: HostAttachment, answer: Uint8Array): Promise<void> {
    // Only the first message answers the challenge; a legitimate host sends nothing else before its first OPEN.
    if (attachment.state !== "challenged") return ws.close(CloseCode.RelayAuthFailed, "relay auth failed");
    patchHost(ws, { state: "verifying" });
    const { relayOrigin, hostId, challenge } = attachment;
    const signPub = await verifyAuthAnswer(relayOrigin, hostId, challenge, answer);
    if (signPub !== undefined && isOpen(ws)) this.#promote(ws, signPub);
    else closeIfOpen(ws, CloseCode.RelayAuthFailed, "relay auth failed");
    this.#settle(ws);
  }

  /** Makes `ws` the host's uplink; an older one is closed with its sessions. */
  #promote(ws: WebSocket, signPub: Uint8Array): void {
    for (const { ws: old, attachment } of withAttachment(this.ctx, HOST_TAG)) {
      if (old === ws || attachment.role !== "host" || attachment.state !== "online") continue;
      this.#dropHost(old, CloseCode.UplinkReplaced, "replaced by a newer uplink");
    }
    patchHost(ws, { state: "online", signPub });
  }

  #fromClient(ws: WebSocket, attachment: ClientAttachment, bytes: Uint8Array): void {
    if (attachment.ended) return;
    const host = onlineHost(this.ctx);
    if (host === undefined) return this.#endClient(ws, CloseCode.HostOffline, "host offline");
    if (!forward(host, encodeData(attachment.sessionId, bytes))) {
      this.#endSession(ws, attachment, CloseCode.IdleTimeout, "the host is too far behind");
    }
  }

  async #fromHost(host: WebSocket, attachment: HostAttachment, bytes: Uint8Array): Promise<void> {
    let frame;
    try {
      frame = decodeMux(bytes);
    } catch (error) {
      if (error instanceof MuxError) return host.close(CloseCode.ProtocolError, error.message);
      throw error;
    }
    if (frame.type === MuxType.Open) return host.close(CloseCode.ProtocolError, "the relay assigns sessions");
    if (frame.type === MuxType.PairSlot) return handlePairSlot(this.env, host, attachment, frame.payload);
    const client = clientSocket(this.ctx, frame.sessionId);
    const session = client === undefined ? undefined : attachmentOf(client);
    // A session the relay or the client just ended: its CLOSE is already on the way to the host.
    if (client === undefined || session?.role !== "client" || session.ended) return;
    if (frame.type === MuxType.Close) return this.#endClient(client, sendableCloseCode(frame.code), "closed by host");
    if (session.pending && !this.#activate(client, session)) return;
    if (!forward(client, frame.payload.slice())) {
      this.#endSession(client, session, CloseCode.IdleTimeout, "the client is too far behind");
    }
  }

  #activate(client: WebSocket, session: ClientAttachment): boolean {
    const active = liveClients(this.ctx).filter(({ attachment }) => !attachment.pending).length;
    if (active >= MAX_ACTIVE_SESSIONS) {
      this.#endSession(client, session, CloseCode.RateLimited, "too many sessions for this host");
      return false;
    }
    patchClient(client, { pending: false });
    return true;
  }

  #closed(ws: WebSocket, code: number): void {
    this.#settle(ws);
    const attachment = attachmentOf(ws);
    if (attachment?.role === "client" && !attachment.ended) this.#endSession(ws, attachment, code, "");
    if (attachment?.role === "host" && attachment.state === "online") this.#dropHost(ws, code, "");
    completeClose(ws, sendableCloseCode(code));
  }

  #dropHost(ws: WebSocket, code: number, reason: string): void {
    patchHost(ws, { state: "replaced" });
    for (const { ws: client } of liveClients(this.ctx)) this.#endClient(client, CloseCode.HostOffline, "host offline");
    closeIfOpen(ws, code, reason);
  }

  /** Ends a session from the relay's side and tells the host with a CLOSE frame. */
  #endSession(ws: WebSocket, session: ClientAttachment, code: number, reason: string): void {
    this.#endClient(ws, code, reason);
    const host = onlineHost(this.ctx);
    if (host !== undefined) sendControl(host, encodeClose(session.sessionId, code));
  }

  /** Ends a session without telling the host: the host closed it, or the host is gone. */
  #endClient(ws: WebSocket, code: number, reason: string): void {
    patchClient(ws, { ended: true });
    closeIfOpen(ws, sendableCloseCode(code), reason);
  }
}
