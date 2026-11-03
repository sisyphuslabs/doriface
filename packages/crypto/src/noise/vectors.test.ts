import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Handshake, type Pattern, PROTOCOL_NAMES } from "./handshake.ts";
import { x25519FromSecret } from "../identity.ts";

interface Vector {
  readonly source: string;
  readonly pattern: Pattern;
  readonly fields: ReadonlyMap<string, string>;
  readonly initPsk: string | undefined;
  readonly respPsk: string | undefined;
  readonly messages: readonly { readonly payload: string; readonly ciphertext: string }[];
}

const hex = (text: string): Uint8Array => Uint8Array.fromHex(text);
const PATTERNS: readonly Pattern[] = ["IK", "IKpsk2"];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const text = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("vector field is not a string");
  return value;
};

async function loadVectors(file: string): Promise<Vector[]> {
  const raw: unknown = JSON.parse(await Bun.file(join(import.meta.dir, "../../vectors", file)).text());
  if (!isRecord(raw) || !Array.isArray(raw["vectors"])) throw new Error(`${file} has no vectors`);
  return raw["vectors"].filter(isRecord).map((entry) => {
    const name = text(entry["protocol_name"] ?? entry["name"]);
    const pattern = PATTERNS.find((p) => PROTOCOL_NAMES[p] === name);
    if (pattern === undefined) throw new Error(`unexpected protocol ${name}`);
    const fields = new Map(Object.entries(entry).flatMap(([k, v]) => (typeof v === "string" ? [[k, v] as const] : [])));
    const firstPsk = (key: string): string | undefined => {
      const psks = entry[key];
      return Array.isArray(psks) ? text(psks[0]) : undefined;
    };
    const messages = Array.isArray(entry["messages"]) ? entry["messages"].filter(isRecord) : [];
    return {
      source: file,
      pattern,
      fields,
      initPsk: firstPsk("init_psks"),
      respPsk: firstPsk("resp_psks"),
      messages: messages.map((m) => ({ payload: text(m["payload"]), ciphertext: text(m["ciphertext"]) })),
    };
  });
}

const vectors = [...(await loadVectors("cacophony.json")), ...(await loadVectors("noise-c-basic.json"))];
const field = (vector: Vector, key: string): Uint8Array => hex(text(vector.fields.get(key)));

describe("Noise test vectors", () => {
  test("cover both patterns", () => {
    expect(vectors.map((v) => `${v.source}:${v.pattern}`)).toEqual([
      "cacophony.json:IK",
      "cacophony.json:IKpsk2",
      "noise-c-basic.json:IK",
    ]);
  });

  test.each(vectors.map((v) => [`${v.source} ${PROTOCOL_NAMES[v.pattern]}`, v] as const))("%s", (_, vector) => {
    const psk = (value: string | undefined) => (value === undefined ? undefined : hex(value));
    expect(vector.initPsk === undefined).toBe(vector.pattern === "IK");
    const initiator = new Handshake({
      pattern: vector.pattern,
      role: "initiator",
      prologue: field(vector, "init_prologue"),
      staticKey: x25519FromSecret(field(vector, "init_static")),
      remoteStatic: field(vector, "init_remote_static"),
      ephemeralSecret: field(vector, "init_ephemeral"),
      psk: psk(vector.initPsk),
    });
    const responder = new Handshake({
      pattern: vector.pattern,
      role: "responder",
      prologue: field(vector, "resp_prologue"),
      staticKey: x25519FromSecret(field(vector, "resp_static")),
      ephemeralSecret: field(vector, "resp_ephemeral"),
      psk: psk(vector.respPsk),
    });
    const [m1, m2, ...transport] = vector.messages;
    if (m1 === undefined || m2 === undefined) throw new Error("vector lacks handshake messages");
    const c1 = initiator.writeMessage(hex(m1.payload));
    expect(c1.toHex()).toBe(m1.ciphertext);
    expect(responder.readMessage(c1).toHex()).toBe(m1.payload);
    const c2 = responder.writeMessage(hex(m2.payload));
    expect(c2.toHex()).toBe(m2.ciphertext);
    expect(initiator.readMessage(c2).toHex()).toBe(m2.payload);

    const i = initiator.finish();
    const r = responder.finish();
    expect(i.handshakeHash.toHex()).toBe(text(vector.fields.get("handshake_hash")));
    expect(r.handshakeHash).toEqual(i.handshakeHash);
    expect(r.remoteStatic).toEqual(x25519FromSecret(field(vector, "init_static")).publicKey);
    transport.forEach((message, index) => {
      const [sender, receiver] = index % 2 === 0 ? [i, r] : [r, i];
      const ciphertext = sender.send.encryptWithAd(new Uint8Array(0), hex(message.payload));
      expect(ciphertext.toHex()).toBe(message.ciphertext);
      expect(receiver.receive.decryptWithAd(new Uint8Array(0), ciphertext).toHex()).toBe(message.payload);
    });
  });
});
