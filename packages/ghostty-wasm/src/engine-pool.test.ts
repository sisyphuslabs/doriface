import { describe, expect, test } from "bun:test";
import { type GhosttyCore, loadGhosttyWasm } from "@wterm/ghostty";
import { EnginePool, TERMINALS_PER_ENGINE } from "./engine-pool.ts";
import { ghosttyWasmUrl } from "./index.ts";

const COLS = 40;
const ROWS = 4;

const memoryOf = (core: GhosttyCore): WebAssembly.Memory =>
  (Reflect.get(core, "wasm") as { exports: { memory: WebAssembly.Memory } }).exports.memory;

function firstRow(core: GhosttyCore): string {
  let text = "";
  for (let col = 0; col < COLS; col += 1) text += String.fromCodePoint(core.getCell(0, col).char || 32);
  return text.trimEnd();
}

function written(core: GhosttyCore, text: string): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  core.writeString(text, resolve);
  return promise;
}

async function cores(pool: EnginePool, count: number): Promise<GhosttyCore[]> {
  const made = await Promise.all(Array.from({ length: count }, () => pool.core()));
  for (const core of made) core.init(COLS, ROWS);
  return made;
}

describe("engine instances shared by terminals (#318)", () => {
  test("terminals share an instance up to the group size, then start another", async () => {
    let loads = 0;
    const pool = new EnginePool(() => {
      loads += 1;
      return loadGhosttyWasm(ghosttyWasmUrl);
    });
    const group = await cores(pool, TERMINALS_PER_ENGINE + 1);
    expect([loads, pool.engines]).toEqual([2, 2]);
    const memories = new Set(group.map(memoryOf));
    expect(memories.size).toBe(2);
    expect(new Set(group.slice(0, TERMINALS_PER_ENGINE).map(memoryOf)).size).toBe(1);
    for (const core of group) core.dispose();
  });

  test("terminals on one instance keep their own screens", async () => {
    const pool = new EnginePool(() => loadGhosttyWasm(ghosttyWasmUrl));
    const [first, second] = await cores(pool, 2);
    if (first === undefined || second === undefined) throw new Error("no cores");
    expect(memoryOf(first)).toBe(memoryOf(second));
    await written(first, "first terminal");
    await written(second, "second terminal");
    expect([firstRow(first), firstRow(second)]).toEqual(["first terminal", "second terminal"]);
    first.dispose();
    await written(second, "\r\nstill here");
    expect(firstRow(second)).toBe("second terminal");
    second.dispose();
  });

  test("an instance is dropped once its last terminal is disposed, and the next terminal gets a fresh one", async () => {
    let loads = 0;
    const pool = new EnginePool(() => {
      loads += 1;
      return loadGhosttyWasm(ghosttyWasmUrl);
    }, 2);
    const [first, second] = await cores(pool, 2);
    if (first === undefined || second === undefined) throw new Error("no cores");
    first.dispose();
    first.dispose();
    expect(pool.engines).toBe(1);
    second.dispose();
    expect(pool.engines).toBe(0);
    const [again] = await cores(pool, 1);
    if (again === undefined) throw new Error("no core");
    expect([loads, pool.engines]).toEqual([2, 1]);
    await written(again, "fresh");
    expect(firstRow(again)).toBe("fresh");
    again.dispose();
  });

  test("an engine wrecked by a trap reaches only its own group", async () => {
    const pool = new EnginePool(() => loadGhosttyWasm(ghosttyWasmUrl), 2);
    const [wrecked, sibling, other] = await cores(pool, 3);
    if (wrecked === undefined || sibling === undefined || other === undefined) throw new Error("no cores");
    expect(memoryOf(wrecked)).toBe(memoryOf(sibling));
    expect(memoryOf(other)).not.toBe(memoryOf(wrecked));
    // What a trap leaves behind: the instance's whole memory, allocator and terminals included, is garbage.
    new Uint8Array(memoryOf(wrecked).buffer).fill(0xff);
    for (const core of [wrecked, sibling]) {
      try {
        core.writeString("after the trap");
      } catch {
        // A wrecked engine may trap again; that stays inside its group.
      }
    }
    await written(other, "other group");
    expect(firstRow(other)).toBe("other group");
    for (const core of [wrecked, sibling, other]) core.dispose();
  });

  test("a load that fails is not reused: the next terminal starts a fresh load", async () => {
    let loads = 0;
    const pool = new EnginePool(() => {
      loads += 1;
      return loads === 1 ? Promise.reject(new Error("out of memory")) : loadGhosttyWasm(ghosttyWasmUrl);
    });
    await expect(pool.core()).rejects.toThrow("out of memory");
    expect(pool.engines).toBe(0);
    const [core] = await cores(pool, 1);
    if (core === undefined) throw new Error("no core");
    expect([loads, pool.engines]).toEqual([2, 1]);
    core.dispose();
  });
});
