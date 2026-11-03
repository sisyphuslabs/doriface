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
const revoked = (written: boolean, lines: readonly string[] = []) => ({
  written,
  target: a,
  subjects: [a, d],
  reason: "compromised",
  lines,
  needsYes: true,
});

describe("doriface-host mesh revoke", () => {
  test("sends mesh-revoke with the member and flags, prints the preview, exits 0 once written", async () => {
    const out = await run(["revoke", "--compromised", "a", "--yes"], [revoked(true, ["the subtree line"])]);
    expect(out.asked).toEqual([{ op: "mesh-revoke", member: "a", compromised: true, yes: true }]);
    expect(out.text).toContain("the subtree line");
    expect(out.text).toContain("revoked a, d (compromised)");
    expect(out.code).toBe(0);
  });

  test("without a terminal to ask, a revoke that needs confirmation is not written and exits 1", async () => {
    const out = await run(["revoke", "--compromised", "a"], [revoked(false)]);
    expect(out.asked).toEqual([{ op: "mesh-revoke", member: "a", compromised: true, yes: false }]);
    expect(out.text).toContain("not written: run it again with --yes");
    expect(out.code).toBe(1);
  });

  test("confirmed on the terminal, it asks the host again with yes", async () => {
    const out = await run(["revoke", "--compromised", "a"], [revoked(false), revoked(true)], true);
    expect(out.asked.map((request) => request.op === "mesh-revoke" && request.yes)).toEqual([false, true]);
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
  test("sends mesh-rename and prints the change", async () => {
    const out = await run(["rename", "a", "a2"], [{ written: true, member: a, name: "a2" }]);
    expect(out.asked).toEqual([{ op: "mesh-rename", member: "a", name: "a2" }]);
    expect(out.text).toContain("renamed a to a2");
    expect(out.code).toBe(0);
  });

  test("an unchanged name says so", async () => {
    const out = await run(["rename", "a", "a"], [{ written: false, member: a, name: "a" }]);
    expect(out.text).toContain("a is already named a");
  });
});

describe("doriface-host mesh leave", () => {
  test("sends mesh-leave and reports how many members confirmed", async () => {
    const reply = { signed: true, members: [f, d], confirmed: [f], revokeCommand: null };
    const out = await run(["leave"], [reply]);
    expect(out.asked).toEqual([{ op: "mesh-leave" }]);
    expect(out.text).toContain("left the mesh: 1 of 2 members confirmed (f)");
    expect(out.code).toBe(0);
  });

  test("reaching nobody, it prints the revoke to run on another member", async () => {
    const reply = { signed: true, members: [f], confirmed: [], revokeCommand: "doriface-host mesh revoke a" };
    const out = await run(["leave"], [reply]);
    expect(out.text).toContain("reached no member");
    expect(out.text).toContain("doriface-host mesh revoke a");
  });
});
