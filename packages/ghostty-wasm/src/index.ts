import { GhosttyCore } from "@wterm/ghostty";
import type { GhosttyOptions } from "@wterm/ghostty";
import buildJson from "../wasm/build.json" with { type: "json" };
import { parseBuildInfo } from "./build-info.ts";

export type { BuildInfo, PatchRecord } from "./build-info.ts";
export { BuildInfoError, parseBuildInfo } from "./build-info.ts";

/** Keep the literal `new URL("...", import.meta.url)` shape: bundlers emit the asset only for that form. */
export const ghosttyWasmUrl: string = new URL("../wasm/ghostty-vt.wasm", import.meta.url).href;

export const ghosttyBuild = parseBuildInfo(buildJson);

export type CoreOptions = Omit<GhosttyOptions, "wasmPath">;

export function loadGhosttyCore(options: CoreOptions = {}): Promise<GhosttyCore> {
  return GhosttyCore.load({ ...options, wasmPath: ghosttyWasmUrl });
}
