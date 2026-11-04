import type { ApprovalCore } from "../approval-live.ts";
import type { Terminal } from "../__generated__/hc-api.ts";
import type { JsonValue } from "../json.ts";

/**
 * One hc core as an approval sees it, in memory: `doc.set` is a compare-and-set that fails with a conflict when the
 * version moved (as hc 0.1.17 does, deletions keep their version), and every key press is logged per terminal.
 * Every call yields first, so concurrent answers interleave between their read and their write. `failNext` makes the
 * next calls of one method throw, as a dropped connection does.
 */
export class MemoryApprovalCore implements ApprovalCore {
  readonly pressed: { readonly address: string; readonly keys: readonly string[] }[] = [];
  readonly #docs = new Map<string, { value: JsonValue; version: number }>();
  #terminal: Terminal;
  #screen: string;
  readonly #failing = new Map<string, { after: number; times: number }>();

  constructor(terminal: Terminal, screen: string) {
    this.#terminal = terminal;
    this.#screen = screen;
  }

  /** The calls of `method` after the next `after` ones throw, `times` of them. */
  failNext(method: "terminal" | "screen" | "keys" | "doc" | "setDoc", times = 1, after = 0): void {
    this.#failing.set(method, { after, times });
  }

  #fail(method: string): void {
    const plan = this.#failing.get(method);
    if (plan === undefined || plan.times === 0) return;
    if (plan.after > 0) return void this.#failing.set(method, { after: plan.after - 1, times: plan.times });
    this.#failing.set(method, { after: 0, times: plan.times - 1 });
    throw new Error(`${method}: the connection dropped`);
  }

  show(terminal: Terminal, screen: string): void {
    this.#terminal = terminal;
    this.#screen = screen;
  }

  async terminal(address: string): Promise<Terminal> {
    await Promise.resolve();
    this.#fail("terminal");
    if (address !== this.#terminal.address) throw new Error(`no terminal ${address}`);
    return this.#terminal;
  }

  async screen(address: string): Promise<string> {
    await Promise.resolve();
    this.#fail("screen");
    if (address !== this.#terminal.address) throw new Error(`no terminal ${address}`);
    return this.#screen;
  }

  async keys(address: string, keys: readonly string[]): Promise<void> {
    await Promise.resolve();
    this.#fail("keys");
    this.pressed.push({ address, keys });
  }

  async doc(name: string, on: string | undefined): Promise<{ readonly value: JsonValue; readonly version: number }> {
    await Promise.resolve();
    this.#fail("doc");
    return this.#docs.get(`${on ?? ""}:${name}`) ?? { value: null, version: 0 };
  }

  async setDoc(name: string, on: string | undefined, value: JsonValue, version: number): Promise<"ok" | "conflict"> {
    await Promise.resolve();
    this.#fail("setDoc");
    const key = `${on ?? ""}:${name}`;
    const current = this.#docs.get(key)?.version ?? 0;
    if (current !== version) return "conflict";
    this.#docs.set(key, { value, version: current + 1 });
    return "ok";
  }

  docNames(): readonly string[] {
    return [...this.#docs.keys()];
  }
}
