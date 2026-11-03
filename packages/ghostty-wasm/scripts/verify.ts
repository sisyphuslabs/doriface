import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseBuildInfo } from "../src/build-info.ts";
import type { BuildInfo, PatchRecord } from "../src/build-info.ts";
import { sha256Hex } from "./artifacts.ts";

const PACKAGE_ROOT = join(import.meta.dir, "..");
const REQUIRED_EXPORTS = ["memory", "init", "write", "get_viewport_v2", "read_response", "get_program_status_state"];

async function patchesOnDisk(): Promise<readonly string[]> {
  const groups = ["ghostty", "wterm"];
  const lists = await Promise.all(
    groups.map(async (group) =>
      (await readdir(join(PACKAGE_ROOT, "patches", group)))
        .filter((name) => name.endsWith(".patch"))
        .map((name) => `patches/${group}/${name}`),
    ),
  );
  return lists.flat().toSorted();
}

async function checkPatch(patch: PatchRecord): Promise<string | null> {
  const file = Bun.file(join(PACKAGE_ROOT, patch.path));
  if (!(await file.exists())) return `${patch.path} is listed but missing`;
  const digest = sha256Hex(await file.bytes());
  return digest === patch.sha256 ? null : `${patch.path} sha256 ${digest}, build.json says ${patch.sha256}`;
}

export async function verify(info: BuildInfo): Promise<readonly string[]> {
  const problems: string[] = [];
  const wasm = await Bun.file(join(PACKAGE_ROOT, "wasm", "ghostty-vt.wasm")).bytes();
  if (wasm.byteLength !== info.bytes) problems.push(`wasm is ${wasm.byteLength} bytes, build.json says ${info.bytes}`);
  const digest = sha256Hex(wasm);
  if (digest !== info.sha256) problems.push(`wasm sha256 ${digest}, build.json says ${info.sha256}`);

  const patchProblems = await Promise.all(info.patches.map(checkPatch));
  problems.push(...patchProblems.filter((problem) => problem !== null));
  const listed = info.patches.map((patch) => patch.path).toSorted();
  const onDisk = await patchesOnDisk();
  if (listed.join("\n") !== onDisk.join("\n"))
    problems.push(`patch set differs: built [${listed}] vs on disk [${onDisk}]`);

  if (!WebAssembly.validate(wasm)) {
    problems.push("wasm does not validate");
  } else {
    const names = new Set(WebAssembly.Module.exports(new WebAssembly.Module(wasm)).map((entry) => entry.name));
    const missing = REQUIRED_EXPORTS.filter((name) => !names.has(name));
    if (missing.length > 0) problems.push(`wasm lacks exports: ${missing.join(", ")}`);
  }
  return problems;
}

if (import.meta.main) {
  const info = parseBuildInfo(await Bun.file(join(PACKAGE_ROOT, "wasm", "build.json")).json());
  const problems = await verify(info);
  for (const problem of problems) console.error(`ghostty-wasm: ${problem}`);
  if (problems.length > 0) process.exit(1);
  console.log(`ghostty-wasm: ${info.ghosttyTag} (${info.ghosttyCommit}) ${info.bytes} bytes sha256 ${info.sha256} OK`);
}
