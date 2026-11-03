import { describe, expect, test } from "bun:test";
import { concatBytes } from "./encoding.ts";
import { CloseCode } from "./link.ts";
import { generateWebCryptoStaticKey } from "./static-key.ts";
import { nextClose } from "./testing/memory-link.ts";
import { SessionKind } from "./kinds.ts";
import {
  codePairing,
  collect,
  device,
  established,
  flush,
  hellos,
  linkPairing,
} from "./testing/secure-link-fixture.ts";
import { MAX_PLAINTEXT } from "./transport.ts";

describe("secureLink", () => {
  test.each([
    ["the typed code", codePairing("laptop"), SessionKind.PairCode],
    ["the link secret", linkPairing("laptop"), SessionKind.PairLink],
  ] as const)("pairs with %s, then reconnects as a session, carrying bytes both ways", async (_, pairing, kind) => {
    const paired = await established({ pairing });
    expect([paired.client.kind, paired.server.kind]).toEqual([kind, kind]);
    expect(paired.server.peerName).toBe("laptop");
    expect(hellos.at(-1)).toMatchObject({ kind, name: "laptop" });
    expect(paired.server.remoteStatic).toEqual(device.publicKey);
    expect(paired.client.handshakeHash).toEqual(paired.server.handshakeHash);

    const again = await established();
    expect([again.client.kind, again.server.kind]).toEqual([SessionKind.Session, SessionKind.Session]);
    expect(hellos.at(-1)?.kind).toBe(SessionKind.Session);
    const atServer = collect(again.server);
    const atClient = collect(again.client);
    again.client.send(new TextEncoder().encode("ping"));
    again.server.send(new TextEncoder().encode("pong"));
    await flush();
    expect(atServer.map((c) => new TextDecoder().decode(c))).toEqual(["ping"]);
    expect(atClient.map((c) => new TextDecoder().decode(c))).toEqual(["pong"]);
  });

  test("a device key held in non-extractable WebCrypto pairs and reconnects (the DH is injected)", async () => {
    const { privateKey, staticKey } = await generateWebCryptoStaticKey();
    expect(privateKey.extractable).toBe(false);
    const paired = await established({ clientKey: staticKey, pairing: codePairing("browser") });
    expect(paired.server.remoteStatic).toEqual(staticKey.publicKey);
    const again = await established({ clientKey: staticKey });
    const atServer = collect(again.server);
    again.client.send(Uint8Array.of(42));
    await flush();
    expect(atServer).toEqual([Uint8Array.of(42)]);
  });

  test("IK early bytes reach the host only after key confirmation, ahead of later data", async () => {
    const early = new TextEncoder().encode('{"jsonrpc":"2.0","id":0,"method":"hello"}\n');
    const { client, server } = await established({ early });
    client.send(Uint8Array.of(1));
    await flush();
    expect(collect(server)).toEqual([early, Uint8Array.of(1)]);
  });

  test("message 2 hands the host's LAN URLs to the client", async () => {
    const lanUrls = ["ws://192.0.2.10:41237/v1/e2ee"];
    const { client, server } = await established({ lanUrls });
    expect(client.lanUrls).toEqual(lanUrls);
    expect(server.lanUrls).toEqual([]);
  });

  test("chunks a 1 MiB write into records of at most 65535 bytes, reassembled in order", async () => {
    const { client, server, clientEnd } = await established();
    const atServer = collect(server);
    const big = crypto.getRandomValues(new Uint8Array(1024 * 1024));
    const before = clientEnd.sent.length;
    client.send(big);
    await flush();
    const records = clientEnd.sent.slice(before);
    expect(records).toHaveLength(Math.ceil(big.byteLength / MAX_PLAINTEXT));
    expect(Math.max(...records.map((r) => r.byteLength))).toBe(65_535);
    expect(atServer.every((chunk) => chunk.byteLength <= MAX_PLAINTEXT)).toBe(true);
    expect(concatBytes(...atServer)).toEqual(big);
  });

  test("completes over a link that delivers inside send() and keeps the first records", async () => {
    const { client, server } = await established({ synchronous: true });
    const atServer = collect(server);
    client.send(Uint8Array.of(7));
    expect(atServer).toEqual([Uint8Array.of(7)]);
  });

  test("a late onClose subscription can still be cancelled", async () => {
    const { client } = await established();
    client.close();
    let called = false;
    client.onClose(() => {
      called = true;
    })();
    await flush();
    expect(called).toBe(false);
  });

  test("data that arrives before the first onData listener is held for it", async () => {
    const { client, server } = await established();
    client.send(Uint8Array.of(1, 2, 3));
    await flush();
    expect(collect(server)).toEqual([Uint8Array.of(1, 2, 3)]);
  });

  test("rekeys every interval: matching sides keep talking, a side that skips the rekey fails with 4400", async () => {
    const good = await established({ rekey: [3, 3] });
    const atServer = collect(good.server);
    for (let i = 0; i < 10; i++) good.client.send(Uint8Array.of(i));
    await flush();
    expect(atServer).toEqual(Array.from({ length: 10 }, (_, i) => Uint8Array.of(i)));

    const skew = await established({ rekey: [3, 1_000] });
    const closed = nextClose(skew.server);
    for (let i = 0; i < 4; i++) skew.client.send(Uint8Array.of(i));
    expect(await closed).toMatchObject({ code: CloseCode.CryptoFailure });
  });
});
