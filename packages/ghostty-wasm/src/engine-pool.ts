import { GhosttyCore, type GhosttyOptions, type GhosttyWasm } from "@wterm/ghostty";

/** Terminals per engine instance: a trap or the 4 GB memory32 cap in one instance reaches at most this many (#318). */
export const TERMINALS_PER_ENGINE = 8;

export type CoreOptions = Omit<GhosttyOptions, "wasmPath">;

interface Engine {
  readonly wasm: Promise<GhosttyWasm>;
  cores: number;
}

/**
 * Engine instances shared by terminals, a few per instance. Each WebAssembly instance owns a memory, and a browser
 * process has a fixed budget of memory reservations; one instance per terminal ran out of it on a page with many
 * terminals, and faster still across reloads (#318). Every ghostty-vt export takes the terminal's own pointer, so cores
 * on one instance stay apart. An instance whose last core is disposed is dropped, so its memory can be collected.
 */
export class EnginePool {
  readonly #load: () => Promise<GhosttyWasm>;
  readonly #size: number;
  readonly #engines = new Set<Engine>();

  constructor(load: () => Promise<GhosttyWasm>, size = TERMINALS_PER_ENGINE) {
    this.#load = load;
    this.#size = size;
  }

  get engines(): number {
    return this.#engines.size;
  }

  /** A core on an engine with room, or on a new one; its `dispose` gives its place back. */
  async core(options: CoreOptions = {}): Promise<GhosttyCore> {
    const engine = this.#withRoom();
    engine.cores += 1;
    let wasm: GhosttyWasm;
    try {
      wasm = await engine.wasm;
    } catch (error) {
      this.#release(engine);
      throw error;
    }
    const core = GhosttyCore.fromWasm(wasm, options);
    const dispose = core.dispose.bind(core);
    let released = false;
    core.dispose = () => {
      dispose();
      if (released) return;
      released = true;
      this.#release(engine);
    };
    return core;
  }

  #withRoom(): Engine {
    for (const engine of this.#engines) if (engine.cores < this.#size) return engine;
    const engine: Engine = { wasm: this.#load(), cores: 0 };
    this.#engines.add(engine);
    // An instance that failed to load takes no more terminals; the next one starts a fresh load.
    engine.wasm.catch(() => this.#engines.delete(engine));
    return engine;
  }

  #release(engine: Engine): void {
    engine.cores -= 1;
    if (engine.cores === 0) this.#engines.delete(engine);
  }
}
