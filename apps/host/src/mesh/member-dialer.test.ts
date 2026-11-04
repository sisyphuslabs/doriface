import { describe, expect, test } from "bun:test";
import { RelayCloseError } from "@doriface/relay-client";
import type { MemberEntry } from "./authorize-index.ts";
import { DialPolicy } from "./dial-policy.ts";
import { MemberDialer } from "./member-dialer.ts";
import { FakeClock, seededRandom } from "./testing/fake-clock.ts";
import { hostIdFor } from "./testing/hc-mesh.ts";

const m: MemberEntry = {
  signPub: "sign-m",
  hostId: hostIdFor("m"),
  noisePub: "noise-m",
  devicePub: undefined,
  name: "m",
  hcId: "hc-m",
};

function dialerRefusedWith(code: number) {
  const policy = new DialPolicy({ clock: new FakeClock(), random: seededRandom(5), onDue: () => undefined });
  const logs: string[] = [];
  const dialer = new MemberDialer({
    policy,
    dial: () => Promise.reject(new RelayCloseError(code, "closed")),
    flushOpen: () => false,
    attach: () => undefined,
    log: (line) => void logs.push(line),
  });
  return { policy, dialer, logs };
}

describe("a sync dial's close code reaches the dial policy (section 8.2, contract v1.6)", () => {
  test("a 4412 gates nothing; a 4429 gates the member as rate limited; a 4404 as offline", async () => {
    const pass = dialerRefusedWith(4412);
    expect(await pass.dialer.sync(m, "push")).toBe(false);
    expect(pass.policy.gate(m.signPub)).toBeUndefined();
    const limited = dialerRefusedWith(4429);
    await limited.dialer.sync(m, "push");
    expect(limited.policy.gate(m.signPub)?.cause).toBe("rate-limited");
    const offline = dialerRefusedWith(4404);
    await offline.dialer.sync(m, "push");
    expect(offline.policy.gate(m.signPub)?.misses).toBe(1);
  });
});
