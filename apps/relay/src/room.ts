import {
  CHALLENGE_BYTES,
  CloseCode,
  decodeMux,
  encodeClose,
  encodeData,
  encodeOpen,
  HOST_ID_PATTERN,
  MuxError,
  MuxType,
  sendableCloseCode,
} from "@doriface/relay-client/wire";
import { DurableObject } from "cloudflare:workers";
import { attach, type ClientAttachment, type HostAttachment, attachmentOf } from "./attachment.ts";
import { verifyAuthAnswer } from "./auth.ts";
import { AUTH_TIMEOUT_MS, MAX_MESSAGE_BYTES, MAX_SESSIONS_PER_HOST } from "./limits.ts";
import { closedSocket } from "./reject.ts";
import {
  CLIENT_TAG,
  clientSocket,
  closeIfOpen,
  completeClose,
  freshSessionId,
  HOST_TAG,
  isOpen,
  newSocketPair,
  onlineHost,
  openClients,
  sendIfOpen,
  sessionTag,
  withAttachment,
} from "./sockets.ts";

/**
 * One room per hostId: the host's uplink and every client session to it. All state lives in socket attachments,
 * so the object can hibernate between messages. Payloads are forwarded as they arrive and never inspected.
 */
export class Room extends DurableObject {
  /** Hosts that have not finished the challenge yet; a client arriving meanwhile waits for them to settle. */
  readonly #pending = new Map<WebSocket, PromiseWithResolvers<void>>();

  override async fetch(request: Request): Promise<Response> {
    const [, , role, hostId = ""] = new URL(request.url).pathname.split("/");
    if (!HOST_ID_PATTERN.test(hostId)) return new Response("bad hostId", { status: 400 });
    if (role === "host") return this.#acceptHost(hostId);
    if (role === "client") return this.#acceptClient(await this.#settledHost());
    return new Response("not found", { status: 404 });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = attachmentOf(ws);
    if (attachment === undefined) return ws.close(CloseCode.InternalError, "unknown socket");
    if (typeof message === "string") return ws.close(CloseCode.UnsupportedData, "binary messages only");
    if (message.byteLength > MAX_MESSAGE_BYTES) return ws.close(CloseCode.MessageTooBig, "message too big");
    const bytes = new Uint8Array(message);
    if (attachment.role === "client") return this.#fromClient(ws, attachment, bytes);
    if (attachment.state === "online") return this.#fromHost(ws, bytes);
    return this.#authenticate(ws, attachment, bytes);
  }

  override webSocketClose(ws: WebSocket, code: number): void {
    this.#closed(ws, code);
  }

  override webSocketError(ws: WebSocket): void {
    this.#closed(ws, CloseCode.InternalError);
  }

  #acceptHost(hostId: string): Response {
    const { client, server } = newSocketPair();
    this.ctx.acceptWebSocket(server, [HOST_TAG]);
    const challenge = crypto.getRandomValues(new Uint8Array(CHALLENGE_BYTES));
    attach(server, { role: "host", hostId, challenge, state: "challenged" });
    this.#pending.set(server, Promise.withResolvers());
    setTimeout(() => {
      if (!this.#pending.has(server)) return;
      closeIfOpen(server, CloseCode.RelayAuthFailed, "relay auth timed out");
      this.#settle(server);
    }, AUTH_TIMEOUT_MS);
    server.send(challenge);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** The online host, after waiting out any host still answering its challenge (bounded by the auth timeout). */
  async #settledHost(): Promise<WebSocket | undefined> {
    const host = onlineHost(this.ctx);
    if (host !== undefined || this.#pending.size === 0) return host;
    await Promise.race([...this.#pending.values()].map(({ promise }) => promise));
    return this.#settledHost();
  }

  #settle(ws: WebSocket): void {
    this.#pending.get(ws)?.resolve();
    this.#pending.delete(ws);
  }

  #acceptClient(host: WebSocket | undefined): Response {
    if (host === undefined) return closedSocket(CloseCode.HostOffline, "host offline");
    if (openClients(this.ctx).length >= MAX_SESSIONS_PER_HOST) {
      return closedSocket(CloseCode.RateLimited, "too many sessions for this host");
    }
    const sessionId = freshSessionId(this.ctx);
    const { client, server } = newSocketPair();
    this.ctx.acceptWebSocket(server, [CLIENT_TAG, sessionTag(sessionId)]);
    attach(server, { role: "client", sessionId, ended: false });
    host.send(encodeOpen(sessionId));
    return new Response(null, { status: 101, webSocket: client });
  }

  async #authenticate(ws: WebSocket, attachment: HostAttachment, answer: Uint8Array): Promise<void> {
    // Only the first message answers the challenge; a legitimate host sends nothing else before its first OPEN.
    if (attachment.state !== "challenged") return ws.close(CloseCode.RelayAuthFailed, "relay auth failed");
    attach(ws, { ...attachment, state: "verifying" });
    const signPub = await verifyAuthAnswer(attachment.hostId, attachment.challenge, answer);
    if (signPub !== undefined && isOpen(ws)) this.#promote(ws, { ...attachment, signPub });
    else closeIfOpen(ws, CloseCode.RelayAuthFailed, "relay auth failed");
    this.#settle(ws);
  }

  /** Makes `ws` the host's uplink; an older one is closed with its sessions. */
  #promote(ws: WebSocket, attachment: HostAttachment): void {
    for (const { ws: old, attachment: other } of withAttachment(this.ctx, HOST_TAG)) {
      if (old === ws || other.role !== "host" || other.state !== "online") continue;
      attach(old, { ...other, state: "replaced" });
      this.#endAllClients();
      closeIfOpen(old, CloseCode.UplinkReplaced, "replaced by a newer uplink");
    }
    attach(ws, { ...attachment, state: "online" });
  }

  #fromClient(ws: WebSocket, attachment: ClientAttachment, bytes: Uint8Array): void {
    const host = onlineHost(this.ctx);
    if (host === undefined) return this.#endClient(ws, attachment, CloseCode.HostOffline, "host offline");
    host.send(encodeData(attachment.sessionId, bytes));
  }

  #fromHost(host: WebSocket, bytes: Uint8Array): void {
    let frame;
    try {
      frame = decodeMux(bytes);
    } catch (error) {
      if (error instanceof MuxError) return host.close(CloseCode.ProtocolError, error.message);
      throw error;
    }
    if (frame.type === MuxType.Open) return host.close(CloseCode.ProtocolError, "the relay assigns sessions");
    const client = clientSocket(this.ctx, frame.sessionId);
    const session = client === undefined ? undefined : attachmentOf(client);
    // A session the client just closed: its CLOSE is already on the way to the host.
    if (client === undefined || session?.role !== "client") return;
    if (frame.type === MuxType.Data) return sendIfOpen(client, frame.payload.slice());
    this.#endClient(client, session, sendableCloseCode(frame.code), "closed by host");
  }

  #closed(ws: WebSocket, code: number): void {
    this.#settle(ws);
    const attachment = attachmentOf(ws);
    if (attachment?.role === "client" && !attachment.ended) {
      attach(ws, { ...attachment, ended: true });
      const host = onlineHost(this.ctx);
      if (host !== undefined) sendIfOpen(host, encodeClose(attachment.sessionId, code));
    }
    if (attachment?.role === "host" && attachment.state === "online") {
      attach(ws, { ...attachment, state: "replaced" });
      this.#endAllClients();
    }
    completeClose(ws, sendableCloseCode(code));
  }

  #endAllClients(): void {
    for (const { ws, attachment } of withAttachment(this.ctx, CLIENT_TAG)) {
      if (attachment.role === "client") this.#endClient(ws, attachment, CloseCode.HostOffline, "host offline");
    }
  }

  #endClient(ws: WebSocket, attachment: ClientAttachment, code: number, reason: string): void {
    attach(ws, { ...attachment, ended: true });
    closeIfOpen(ws, code, reason);
  }
}
