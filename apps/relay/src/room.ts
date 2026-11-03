import {
  CHALLENGE_BYTES,
  CloseCode,
  decodeMux,
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
import { asksForCredit, creditFromHost, forwardedToHost, hostServesCredit, openCredit, textFrom } from "./credit.ts";
import { forward, sendControl } from "./flow.ts";
import { sourceOf } from "./limits.ts";
import type { PairSlotsEnv } from "./pair-slot.ts";
import { handlePairSlot, PairingCharges, pairingRefusal } from "./pairing.ts";
import { PendingAuths } from "./pending-auths.ts";
import { alarmBy, overdue, type TimeoutVars, timeoutsOf } from "./reaper.ts";
import { closedSocket } from "./reject.ts";
import { dropHost, endClient, endSession } from "./session-end.ts";
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
  readonly #authenticating = new PendingAuths();
  readonly #charges = new PairingCharges((slot) =>
    this.env.PAIR_SLOTS.get(this.env.PAIR_SLOTS.idFromName(slot)).chargeSession(),
  );

  constructor(ctx: DurableObjectState, env: RoomEnv) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const [, , role, hostId = ""] = url.pathname.split("/");
    if (!HOST_ID_PATTERN.test(hostId)) return new Response("bad hostId", { status: 400 });
    if (role === "host") return this.#acceptHost(hostId, relayOriginOf(request.url), asksForCredit(url));
    if (role !== "client") return new Response("not found", { status: 404 });
    if ((await this.#settledHost()) === undefined) return closedSocket(CloseCode.HostOffline, "host offline");
    const source = sourceOf(request);
    const pairSlot = url.searchParams.get("pair") ?? undefined;
    const refusal = pairSlot === undefined ? undefined : await pairingRefusal(this.env, hostId, pairSlot, source);
    if (refusal !== undefined) return closedSocket(refusal.code, refusal.reason);
    return this.#acceptClient(source, pairSlot, asksForCredit(url));
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = attachmentOf(ws);
    if (attachment === undefined) return ws.close(CloseCode.InternalError, "unknown socket");
    if (typeof message === "string") return textFrom(this.ctx, ws, attachment, message);
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
      if (attachment.role === "client") endSession(this.ctx, ws, attachment, CloseCode.IdleTimeout, reason);
      else if (attachment.state === "online") dropHost(this.ctx, ws, CloseCode.IdleTimeout, reason);
      // A socket that never became (or no longer is) the uplink owns no sessions.
      else closeIfOpen(ws, CloseCode.IdleTimeout, reason);
    }
    if (next !== undefined) await this.ctx.storage.setAlarm(next);
  }

  async #acceptHost(hostId: string, relayOrigin: string, credit: boolean): Promise<Response> {
    const { client, server } = newSocketPair();
    this.ctx.acceptWebSocket(server, [HOST_TAG]);
    const challenge = crypto.getRandomValues(new Uint8Array(CHALLENGE_BYTES));
    const openedAt = Date.now();
    attach(server, {
      role: "host",
      hostId,
      relayOrigin,
      challenge,
      state: "challenged",
      credit,
      sent: 0,
      acked: 0,
      openedAt,
    });
    const { authMs, idleMs } = timeoutsOf(this.env);
    this.#authenticating.begin(server, authMs, () =>
      closeIfOpen(server, CloseCode.RelayAuthFailed, "relay auth timed out"),
    );
    sendControl(server, challenge);
    await alarmBy(this.ctx, openedAt + idleMs);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** The online host, after waiting out any host still answering its challenge (bounded by the auth timeout). */
  async #settledHost(): Promise<WebSocket | undefined> {
    const host = onlineHost(this.ctx);
    if (host !== undefined || this.#authenticating.size === 0) return host;
    await this.#authenticating.allPendingNow();
    return onlineHost(this.ctx);
  }

  /** Admits a session as pending (contract v1.2 C1); it counts against the 32 only once the host sends DATA. */
  async #acceptClient(ip: string, pairSlot: string | undefined, credit: boolean): Promise<Response> {
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
        endSession(this.ctx, victim.ws, victim.attachment, CloseCode.RateLimited, "too many pending sessions");
      }
    }
    const sessionId = freshSessionId(this.ctx);
    const { client, server } = newSocketPair();
    this.ctx.acceptWebSocket(server, [CLIENT_TAG, sessionTag(sessionId)]);
    const openedAt = Date.now();
    const session = {
      role: "client",
      sessionId,
      ended: false,
      pending: true,
      ip,
      pairSlot,
      credit: credit && hostServesCredit(host),
      sent: 0,
      acked: 0,
      openedAt,
    } as const;
    attach(server, session);
    sendControl(host, encodeOpen(sessionId, pairSlot));
    openCredit(host, server, session);
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
    this.#authenticating.settle(ws);
  }

  /** Makes `ws` the host's uplink; an older one is closed with its sessions. */
  #promote(ws: WebSocket, signPub: Uint8Array): void {
    for (const { ws: old, attachment } of withAttachment(this.ctx, HOST_TAG)) {
      if (old === ws || attachment.role !== "host" || attachment.state !== "online") continue;
      dropHost(this.ctx, old, CloseCode.UplinkReplaced, "replaced by a newer uplink");
    }
    patchHost(ws, { state: "online", signPub });
  }

  #fromClient(ws: WebSocket, attachment: ClientAttachment, bytes: Uint8Array): void {
    if (attachment.ended) return;
    const host = onlineHost(this.ctx);
    if (host === undefined) return endClient(ws, CloseCode.HostOffline, "host offline");
    if (!forward(host, encodeData(attachment.sessionId, bytes))) {
      return endSession(this.ctx, ws, attachment, CloseCode.IdleTimeout, "the host is too far behind");
    }
    forwardedToHost(host, ws, attachment, bytes.byteLength);
  }

  async #fromHost(host: WebSocket, attachment: HostAttachment, bytes: Uint8Array): Promise<void> {
    let frame;
    try {
      frame = decodeMux(bytes);
    } catch (error) {
      if (error instanceof MuxError) return host.close(CloseCode.RelayProtocolError, error.message);
      throw error;
    }
    if (frame.type === MuxType.Open || frame.type === MuxType.PairSlotAck) {
      return host.close(CloseCode.RelayProtocolError, "OPEN and PAIR_SLOT_ACK go relay to host only");
    }
    if (frame.type === MuxType.Credit) return creditFromHost(this.ctx, host, frame.sessionId, frame.bytes);
    if (frame.type === MuxType.PairSlot)
      return handlePairSlot(this.env, this.ctx.storage, host, attachment, frame.payload);
    const client = clientSocket(this.ctx, frame.sessionId);
    const session = client === undefined ? undefined : attachmentOf(client);
    // A session the relay or the client just ended: its CLOSE is already on the way to the host.
    if (client === undefined || session?.role !== "client" || session.ended) return;
    if (frame.type === MuxType.Close) return endClient(client, sendableCloseCode(frame.code), "closed by host");
    if (session.pending) {
      if (!this.#activate(client, session)) return;
      // A pairing session is charged to its slot once the host has answered it, i.e. on this first DATA.
      if (session.pairSlot !== undefined) {
        const outcome = await this.#charges.charge(session.sessionId, session.pairSlot);
        if (outcome !== "charged") return this.#refuseCharge(client, session, outcome);
      }
    } else {
      const charging = this.#charges.inFlight(session.sessionId);
      if (charging !== undefined && (await charging) !== "charged") return;
    }
    if (!forward(client, frame.payload.slice())) {
      endSession(this.ctx, client, session, CloseCode.IdleTimeout, "the client is too far behind");
    }
  }

  #refuseCharge(client: WebSocket, session: ClientAttachment, outcome: "spent" | "failed"): void {
    if (outcome === "spent")
      endSession(this.ctx, client, session, CloseCode.RateLimited, "pairing budget spent for this slot");
    else endSession(this.ctx, client, session, CloseCode.InternalError, "could not charge the pairing session");
  }

  #activate(client: WebSocket, session: ClientAttachment): boolean {
    const active = liveClients(this.ctx).filter(({ attachment }) => !attachment.pending).length;
    if (active >= MAX_ACTIVE_SESSIONS) {
      endSession(this.ctx, client, session, CloseCode.RateLimited, "too many sessions for this host");
      return false;
    }
    patchClient(client, { pending: false });
    return true;
  }

  #closed(ws: WebSocket, code: number): void {
    this.#authenticating.settle(ws);
    const attachment = attachmentOf(ws);
    if (attachment?.role === "client" && !attachment.ended) endSession(this.ctx, ws, attachment, code, "");
    if (attachment?.role === "host" && attachment.state === "online") dropHost(this.ctx, ws, code, "");
    completeClose(ws, sendableCloseCode(code));
  }
}
