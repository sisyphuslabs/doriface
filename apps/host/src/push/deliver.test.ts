import { NOTICE_KINDS } from "@doriface/protocol";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decryptPushBody, receiverKeys } from "../testing/push-receiver.ts";
import { deliverPush, type PushFetch } from "./deliver.ts";
import { loadVapidKey } from "./vapid-key.ts";

describe("what the push service can learn from a notice's size", () => {
  test("every kind encrypts to one length, and the browser still reads each notice", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dh-push-pad-"));
    try {
      const vapid = await loadVapidKey(dir);
      const keys = await receiverKeys();
      const bodies: Uint8Array[] = [];
      const post: PushFetch = async (_, init) => {
        bodies.push(new Uint8Array(await new Response(init.body).arrayBuffer()));
        return new Response(null, { status: 201 });
      };
      const subscription = {
        endpoint: "https://fcm.googleapis.com/fcm/send/pad",
        p256dh: keys.p256dh,
        auth: keys.auth,
      };
      await Promise.all(
        NOTICE_KINDS.map((k) =>
          deliverPush(
            subscription,
            { v: 1, n: "AAAAAAAAAAAAAAAAAAAAAA", k, h: "abcdefghijklmnopqrstuvwxyz" },
            vapid,
            post,
          ),
        ),
      );
      expect(new Set(bodies.map((body) => body.byteLength)).size).toBe(1);
      const kinds = await Promise.all(
        bodies.map(async (body) => JSON.parse(new TextDecoder().decode(await decryptPushBody(body, keys))).k),
      );
      expect(kinds.toSorted()).toEqual([...NOTICE_KINDS].toSorted());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
