import { generateX25519 } from "@doriface/crypto";
import { LinkClosedError } from "@doriface/relay-client";
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PairingSlots } from "./pairing-slots.ts";
import { PairingStore } from "./state/pairing.ts";

const stateDir = mkdtempSync(join(tmpdir(), "dh-slots-final-"));
afterAll(() => rmSync(stateDir, { recursive: true, force: true }));

test("after the uplink stopped for good, offers register nothing and read as unavailable", async () => {
  const registered: string[] = [];
  const registrar = {
    register: (slot: string) => {
      registered.push(slot);
      return Promise.reject(new LinkClosedError("the uplink stopped"));
    },
    release: () => {},
  };
  const slots = new PairingSlots(
    new PairingStore(stateDir, () => {}),
    generateX25519().publicKey,
    registrar,
    () => {},
    60_000,
  );
  slots.start();
  slots.relayGone();
  const offer = await slots.open();
  slots.stop();
  expect(registered).toEqual([]);
  expect(offer.slot).toBe("unavailable");
});
