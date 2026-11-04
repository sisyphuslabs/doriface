import { base64urlDecode, base64urlEncode } from "@doriface/crypto";
import { describe, expect, test } from "bun:test";
import { decryptPushBody, receiverKeys, receiverKeysFrom, verifyVapid } from "../testing/push-receiver.ts";
import { encryptPushPayload, type SenderKey, VAPID_SUBJECT, vapidAuthorization } from "./web-push.ts";

// RFC 8291 Appendix A.
const A = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_" +
    "yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

async function rfcSender(): Promise<SenderKey> {
  const pub = base64urlDecode(A.asPublic);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: A.asPrivate,
    x: base64urlEncode(pub.subarray(1, 33)),
    y: base64urlEncode(pub.subarray(33)),
  };
  const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, [
    "deriveBits",
  ]);
  return { privateKey, publicKey: pub };
}

const utf8 = (value: string) => new TextEncoder().encode(value);

describe("RFC 8291 payload encryption", () => {
  test("reproduces Appendix A byte for byte", async () => {
    const body = await encryptPushPayload(
      utf8(A.plaintext),
      { p256dh: A.uaPublic, auth: A.auth },
      { sender: await rfcSender(), salt: base64urlDecode(A.salt) },
    );
    expect(base64urlEncode(body)).toBe(A.body);
  });

  test("the browser's key decrypts it; nothing of the plaintext is in the body", async () => {
    const keys = await receiverKeysFrom(A.uaPrivate, A.uaPublic, A.auth);
    const body = await encryptPushPayload(utf8(A.plaintext), keys);
    expect(new TextDecoder().decode(await decryptPushBody(body, keys))).toBe(A.plaintext);
    expect(Buffer.from(body).includes(Buffer.from("watermelon"))).toBe(false);
  });

  test("another subscription's keys cannot decrypt it", async () => {
    const body = await encryptPushPayload(utf8("x"), await receiverKeys());
    await expect(decryptPushBody(body, await receiverKeys())).rejects.toThrow();
  });
});

describe("RFC 8292 VAPID", () => {
  test("the header verifies under its own key, for the endpoint's origin, for 12 hours", async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const publicKey = base64urlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
    const header = await vapidAuthorization(
      "https://fcm.googleapis.com/fcm/send/abc",
      { privateKey: pair.privateKey, publicKey },
      1_000_000,
    );
    const { key, claims } = await verifyVapid(header);
    expect(key).toBe(publicKey);
    expect(claims).toEqual({ aud: "https://fcm.googleapis.com", exp: 1_000 + 12 * 3600, sub: VAPID_SUBJECT });
  });
});
