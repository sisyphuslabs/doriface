import { type GhosttyCore, loadGhosttyWasm } from "@wterm/ghostty";
import buildJson from "../wasm/build.json" with { type: "json" };
import { parseBuildInfo } from "./build-info.ts";
import { type CoreOptions, EnginePool } from "./engine-pool.ts";

export type { BuildInfo, PatchRecord } from "./build-info.ts";
export { BuildInfoError, parseBuildInfo } from "./build-info.ts";

/** Keep the literal `new URL("...", import.meta.url)` shape: bundlers emit the asset only for that form. */
export const ghosttyWasmUrl: string = new URL("../wasm/ghostty-vt.wasm", import.meta.url).href;

export const ghosttyBuild = parseBuildInfo(buildJson);

export type { CoreOptions } from "./engine-pool.ts";
export { EnginePool, TERMINALS_PER_ENGINE } from "./engine-pool.ts";

const engines = new EnginePool(() => loadGhosttyWasm(ghosttyWasmUrl));

/** A terminal core on a shared engine instance (#318); its `dispose` frees the terminal and its place on the engine. */
export function loadGhosttyCore(options: CoreOptions = {}): Promise<GhosttyCore> {
  return engines.core(options);
}
