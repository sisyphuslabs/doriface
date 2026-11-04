import type { ApprovalCore } from "../approval-live.ts";
import type { Terminal } from "../__generated__/hc-api.ts";
import type { JsonValue } from "../json.ts";

/**
 * One hc core as an approval sees it, in memory: `doc.set` is a compare-and-set that fails with a conflict when the
 * version moved (as hc 0.1.17 does, deletions keep their version), and every key press is logged per terminal.
 * Every call yields first, so concurrent answers interleave between their read and their write.
 */
export class MemoryApprovalCore implements ApprovalCore {
  readonly pressed: { readonly address: string; readonly keys: readonly string[] }[] = [];
  readonly #docs = new Map<string, { value: JsonValue; version: number }>();
  #terminal: Terminal;
  #screen: string;

  constructor(terminal: Terminal, screen: string) {
    this.#terminal = terminal;
    this.#screen = screen;
  }

  show(terminal: Terminal, screen: string): void {
    this.#terminal = terminal;
    this.#screen = screen;
  }

  async terminal(address: string): Promise<Terminal> {
    await Promise.resolve();
    if (address !== this.#terminal.address) throw new Error(`no terminal ${address}`);
    return this.#terminal;
  }

  async screen(address: string): Promise<string> {
    await Promise.resolve();
    if (address !== this.#terminal.address) throw new Error(`no terminal ${address}`);
    return this.#screen;
  }

  async keys(address: string, keys: readonly string[]): Promise<void> {
    await Promise.resolve();
    this.pressed.push({ address, keys });
  }

  async doc(name: string, on: string | undefined): Promise<{ readonly value: JsonValue; readonly version: number }> {
    await Promise.resolve();
    return this.#docs.get(`${on ?? ""}:${name}`) ?? { value: null, version: 0 };
  }

  async setDoc(name: string, on: string | undefined, value: JsonValue, version: number): Promise<"ok" | "conflict"> {
    await Promise.resolve();
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
