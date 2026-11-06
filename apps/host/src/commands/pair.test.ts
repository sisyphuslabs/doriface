import { base64urlEncode, buildPairingUrl, DEFAULT_RELAY_URL, formatPairingCode } from "@doriface/crypto";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderUnicodeCompact } from "uqr";
import { listenControl } from "../control.ts";
import { loadHostIdentity } from "../state/host-keys.ts";
import { PairingStore, pendingToWire } from "../state/pairing.ts";
import { meshJoinCommand } from "./mesh-join.ts";
import { pairCommand } from "./pair.ts";

function linkOf(text: string, prefix: string): string {
  const line = text.split("\n").find((candidate) => candidate.startsWith(prefix));
  if (line === undefined) throw new Error(`no ${prefix} link in:\n${text}`);
  return line;
}

const fragmentOf = (link: string): URLSearchParams => new URLSearchParams(new URL(link).hash.slice(1));

const withStateDir = async (name: string, run: (dir: string) => Promise<void>): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), name));
  try {
    await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("doriface-host pair", () => {
  test("prints the desktop app's deep link by default, never the dead web origin", async () => {
    await withStateDir("dh-pair-", async (dir) => {
      let text = "";
      await pairCommand(["--no-qr", "--state-dir", dir], (chunk) => void (text += chunk));
      expect(text).not.toContain("https://doriface.omo.dev");
      expect(text.split("\n").filter((line) => line.startsWith("http"))).toEqual([]);
      expect(text).toContain("doriface desktop app");
      const link = linkOf(text, "doriface://pair#");
      expect([...fragmentOf(link).keys()]).toEqual(["h", "k", "s", "p", "r"]);
      const offer = new PairingStore(dir).read();
      if (offer === undefined) throw new Error("pair printed a link but stored no offer");
      expect(fragmentOf(link).get("p")).toBe(base64urlEncode(offer.linkSecret));
      expect(text).toContain(formatPairingCode(offer.code));
    });
  });

  test("the QR code is the hosted web app's /pair page for a phone, while the printed link stays the deep link", async () => {
    await withStateDir("dh-pair-qr-", async (dir) => {
      let text = "";
      await pairCommand(["--state-dir", dir], (chunk) => void (text += chunk));
      const identity = loadHostIdentity(dir);
      const offer = new PairingStore(dir).read();
      if (offer === undefined) throw new Error("pair printed a QR code but stored no offer");
      const phone = buildPairingUrl({
        webOrigin: "https://doriface.omo.dev",
        hostId: identity.hostId,
        noiseStaticPub: identity.noise.publicKey,
        signPub: identity.sign.publicKey,
        linkSecret: offer.linkSecret,
        relayUrl: DEFAULT_RELAY_URL,
      });
      expect(text).toContain(renderUnicodeCompact(phone, { ecc: "L", border: 2 }));
      expect(new URL(linkOf(text, "doriface://pair#")).hash).toBe(new URL(phone).hash);
    });
  });

  test("--web-origin still prints that origin's pairing page, and says it opens in a browser", async () => {
    await withStateDir("dh-pair-web-", async (dir) => {
      let text = "";
      await pairCommand(["--no-qr", "--web-origin", "https://web.example", "--state-dir", dir], (chunk) => {
        text += chunk;
      });
      const link = linkOf(text, "https://web.example/pair#");
      expect([...fragmentOf(link).keys()]).toEqual(["h", "k", "s", "p", "r"]);
      expect(text).not.toContain("doriface://pair#");
      expect(text).not.toContain("https://doriface.omo.dev");
      expect(text).toContain("browser");
    });
  });
});

describe("doriface-host mesh pair", () => {
  test("prints a deep link the joining machine can hand to mesh join, never the dead web origin", async () => {
    await withStateDir("dh-mesh-pair-", async (dir) => {
      const offer = new PairingStore(dir).offer(Date.now(), true);
      const control = listenControl(dir, () => Promise.resolve(pendingToWire(offer)));
      let text = "";
      try {
        await meshJoinCommand(
          ["pair", "--auto", "--no-qr", "--state-dir", dir],
          (chunk) => void (text += chunk),
          () => {},
        );
      } finally {
        control.stop();
      }
      expect(text).not.toContain("https://doriface.omo.dev");
      const link = linkOf(text, "doriface://pair#");
      const fragment = fragmentOf(link);
      expect([...fragment.keys()]).toEqual(["h", "k", "s", "p", "r", "m"]);
      expect(fragment.get("p")).toBe(base64urlEncode(offer.linkSecret));
      expect(fragment.get("m")).toBe("1");
      expect(text).toContain("mesh join");
    });
  });

  test("--web-origin still prints that origin's page, with the mesh flag", async () => {
    await withStateDir("dh-mesh-pair-web-", async (dir) => {
      const offer = new PairingStore(dir).offer(Date.now(), true);
      const control = listenControl(dir, () => Promise.resolve(pendingToWire(offer)));
      let text = "";
      try {
        await meshJoinCommand(
          ["pair", "--auto", "--no-qr", "--web-origin", "https://web.example", "--state-dir", dir],
          (chunk) => void (text += chunk),
          () => {},
        );
      } finally {
        control.stop();
      }
      const link = linkOf(text, "https://web.example/pair#");
      expect(fragmentOf(link).get("m")).toBe("1");
      expect(text).not.toContain("doriface://pair#");
      expect(text).not.toContain("https://doriface.omo.dev");
    });
  });
});
