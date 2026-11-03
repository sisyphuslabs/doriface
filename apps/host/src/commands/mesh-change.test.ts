import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ControlRequest, listenControl } from "../control.ts";
import { meshCommand } from "./mesh.ts";

interface Run {
  readonly code: number;
  readonly text: string;
  readonly asked: readonly ControlRequest[];
}

/** Runs `mesh <args>` against a control socket answering each request with the next of `answers`, then null. */
async function run(args: readonly string[], answers: readonly unknown[], terminal = false): Promise<Run> {
  const dir = mkdtempSync(join(tmpdir(), "dh-mesh-change-"));
  const asked: ControlRequest[] = [];
  const control = listenControl(dir, async (request) => {
    asked.push(request);
    return answers[asked.length - 1] ?? null;
  });
  let text = "";
  try {
    const confirm = () => Promise.resolve(terminal);
    const code = await meshCommand([...args, "--state-dir", dir], (chunk) => void (text += chunk), confirm);
    return { code, text, asked };
  } finally {
    control.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

const a = { hostId: "a".repeat(26), name: "a" };
const d = { hostId: "d".repeat(26), name: "d" };
const f = { hostId: "f".repeat(26), name: "f" };
const revoke = (written: boolean, needsYes = true) => ({
  written,
  target: a,
  subjects: [a, d],
  reason: "compromised",
  lines: [],
  needsYes,
});
const ask = { op: "mesh-revoke", member: "a", compromised: true } as const;
const write = { ...ask, yes: true, preview: false, expect: [a.hostId, d.hostId] };

describe("doriface-host mesh revoke", () => {
  test("previews first, prints each subject's name and hostId, then writes exactly the previewed subjects", async () => {
    const out = await run(["revoke", "--compromised", "a", "--yes"], [revoke(false), revoke(true)]);
    expect(out.asked).toEqual([{ ...ask, yes: true, preview: true }, write]);
    expect(out.text).toContain(`a (${a.hostId})`);
    expect(out.text).toContain(`d (${d.hostId})`);
    expect(out.code).toBe(0);
  });

  test("without a terminal to ask, a revoke that needs confirmation is only previewed and exits 1", async () => {
    const out = await run(["revoke", "--compromised", "a"], [revoke(false)]);
    expect(out.asked).toEqual([{ ...ask, yes: false, preview: true }]);
    expect(out.code).toBe(1);
  });

  test("confirmed on the terminal, it writes the previewed subjects", async () => {
    const out = await run(["revoke", "--compromised", "a"], [revoke(false), revoke(true)], true);
    expect(out.asked).toEqual([{ ...ask, yes: false, preview: true }, write]);
    expect(out.code).toBe(0);
  });

  test("a revoke that needs no confirmation is previewed, then written", async () => {
    const out = await run(["revoke", "a"], [revoke(false, false), revoke(true, false)]);
    expect(out.asked.map((request) => request.op === "mesh-revoke" && request.preview)).toEqual([true, false]);
    expect(out.code).toBe(0);
  });

  test("a host in no mesh exits 1", async () => {
    expect((await run(["revoke", "a", "--yes"], [null])).code).toBe(1);
  });

  test("takes exactly one member", async () => {
    await expect(run(["revoke"], [])).rejects.toThrow("mesh revoke needs one member");
  });
});

describe("doriface-host mesh rename", () => {
  test("sends mesh-rename and prints the member's hostId", async () => {
    const out = await run(["rename", "a", "a2"], [{ written: true, member: a, name: "a2" }]);
    expect(out.asked).toEqual([{ op: "mesh-rename", member: "a", name: "a2" }]);
    expect(out.text).toContain(a.hostId);
    expect(out.code).toBe(0);
  });
});

describe("doriface-host mesh leave", () => {
  test("sends mesh-leave and exits 0 once it left", async () => {
    const reply = { signed: true, members: [f, d], confirmed: [f], revokeCommand: null };
    const out = await run(["leave"], [reply]);
    expect(out.asked).toEqual([{ op: "mesh-leave" }]);
    expect(out.code).toBe(0);
  });

  test("reaching nobody, it prints the revoke to run on another member", async () => {
    const reply = { signed: true, members: [f], confirmed: [], revokeCommand: "doriface-host mesh revoke a" };
    expect((await run(["leave"], [reply])).text).toContain("doriface-host mesh revoke a");
  });
});
