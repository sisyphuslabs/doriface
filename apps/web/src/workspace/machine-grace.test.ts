import type { MachineView } from "@doriface/protocol";
import { expect, test } from "bun:test";
import { graceEnds, graceViews, OFFLINE_GRACE_MS, stepHeld } from "./machine-grace.ts";
import { withReach } from "./reach.ts";

const machine = (name: string, state: string, since_ms: number | null = null): MachineView => ({
  name,
  state,
  id: `id-${name}`,
  host: name,
  target: name,
  version: "0.1.17",
  since_ms,
  why: state === "unreachable" ? "cannot reach: the mesh settles for 13 s" : null,
});

const shown = (list: readonly MachineView[], held: ReadonlyMap<string, number>, now: number) =>
  graceViews(list, held, now).map((view) => [view.name, view.state]);

test("a connected machine whose line is redialing reads connected until the grace ends, then offline", () => {
  const connected = [machine("rack", "connected")];
  const dropped = [machine("rack", "unreachable", 1_000)];
  const held = stepHeld(new Map(), connected, dropped, 1_050);
  expect(shown(dropped, held, 1_050)).toEqual([["rack", "connected"]]);
  expect(graceViews(dropped, held, 1_050)[0]).toMatchObject({ why: null, since_ms: null });
  const again = stepHeld(held, dropped, dropped, 1_050 + 30_000);
  expect(again.get("id-rack")).toBe(1_000);
  expect(shown(dropped, again, 1_000 + OFFLINE_GRACE_MS - 1)).toEqual([["rack", "connected"]]);
  expect(shown(dropped, again, 1_000 + OFFLINE_GRACE_MS)).toEqual([["rack", "unreachable"]]);
  expect(stepHeld(again, dropped, dropped, 1_000 + OFFLINE_GRACE_MS).size).toBe(0);
});

test("hc's since moves a hold back at most one read, whatever the host's clock says", () => {
  const connected = [machine("rack", "connected")];
  expect(stepHeld(new Map(), connected, [machine("rack", "unreachable", 0)], 100_000).get("id-rack")).toBe(90_000);
  expect(stepHeld(new Map(), connected, [machine("rack", "unreachable", 500_000)], 100_000).get("id-rack")).toBe(
    100_000,
  );
  expect(stepHeld(new Map(), connected, [machine("rack", "connecting")], 100_000).get("id-rack")).toBe(100_000);
});

test("a line back inside the grace never showed anything but connected, and a second drop starts a fresh grace", () => {
  const connected = [machine("rack", "connected")];
  const dropped = [machine("rack", "connecting")];
  const held = stepHeld(new Map(), connected, dropped, 0);
  expect(shown(dropped, held, 10_000)).toEqual([["rack", "connected"]]);
  const back = stepHeld(held, dropped, connected, 16_000);
  expect(back.size).toBe(0);
  expect(stepHeld(back, connected, dropped, 100_000).get("id-rack")).toBe(100_000);
});

test("needs login shows at once, and a machine down since before the page read it reads offline at once", () => {
  const before = [machine("rack", "connected"), machine("air", "connected")];
  const login = [machine("rack", "needs_login"), machine("air", "connected")];
  expect(stepHeld(new Map(), before, login, 0).size).toBe(0);
  const asleep = [machine("air", "unreachable", 1_000)];
  const first = stepHeld(new Map(), [], asleep, 1_000 + 3_600_000);
  expect(shown(asleep, first, 1_000 + 3_600_000)).toEqual([["air", "unreachable"]]);
});

test("a page opened mid-blip holds a machine only for what is left of the grace after hc's own since", () => {
  const blip = [machine("rack", "unreachable", 10_000)];
  const held = stepHeld(new Map(), [], blip, 30_000);
  expect(shown(blip, held, 30_000)).toEqual([["rack", "connected"]]);
  expect(graceEnds(held, 30_000)).toBe(10_000 + OFFLINE_GRACE_MS);
  expect(shown(blip, held, 10_000 + OFFLINE_GRACE_MS)).toEqual([["rack", "unreachable"]]);
  expect(graceEnds(held, 10_000 + OFFLINE_GRACE_MS)).toBeUndefined();
});

test("a held machine's live terminals stay live in its grace and read offline once it ends", () => {
  const live = {
    address: "rack/t1",
    argv: ["sh"],
    cols: 80,
    rows: 24,
    created_ms: 0,
    cwd: "/",
    labels: {},
    screen: "exact",
    state: "live",
    status: { state: "working" },
  };
  const dropped = [machine("rack", "unreachable", 0)];
  const held = stepHeld(new Map(), [machine("rack", "connected")], dropped, 0);
  expect(withReach([live], graceViews(dropped, held, 44_000))[0]?.offline).toBeUndefined();
  expect(withReach([live], graceViews(dropped, held, OFFLINE_GRACE_MS))[0]?.offline).toBe(true);
});
