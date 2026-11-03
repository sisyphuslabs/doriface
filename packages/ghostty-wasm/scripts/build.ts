import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { BuildInfo, PatchRecord } from "../src/build-info.ts";
import { run, sha256Hex } from "./artifacts.ts";
import { GHOSTTY, OPTIMIZE, WTERM, ZIG_VERSION } from "./pins.ts";
import {
  applyPatches,
  assertZigMatchesGhostty,
  fetchGhostty,
  fetchWrapper,
  installZig,
  listPatches,
  resolveGhostty,
} from "./sources.ts";

const PACKAGE_ROOT = join(import.meta.dir, "..");
const PATCH_ROOT = join(PACKAGE_ROOT, "patches");
const WASM_PATH = join(PACKAGE_ROOT, "wasm", "ghostty-vt.wasm");
const BUILD_JSON_PATH = join(PACKAGE_ROOT, "wasm", "build.json");

const { values } = parseArgs({
  options: {
    ref: { type: "string", default: GHOSTTY.tag },
    zig: { type: "string" },
    keep: { type: "boolean", default: false },
  },
});

async function patchRecords(patches: readonly string[]): Promise<readonly PatchRecord[]> {
  return Promise.all(
    patches.map(async (path) => ({
      path: `patches/${path}`,
      sha256: sha256Hex(await Bun.file(join(PATCH_ROOT, path)).bytes()),
    })),
  );
}

async function build(work: string): Promise<BuildInfo> {
  const revision = await resolveGhostty(values.ref);
  console.log(`ghostty ${revision.tag} (${revision.commit}), zig ${ZIG_VERSION}`);
  const ghostty = await fetchGhostty(revision, work);
  await assertZigMatchesGhostty(ghostty.dir);
  const wrapper = await fetchWrapper(work);
  const zig = values.zig ?? (await installZig(work));

  const ghosttyPatches = await listPatches(PATCH_ROOT, "ghostty");
  const wtermPatches = await listPatches(PATCH_ROOT, "wterm");
  await applyPatches(PATCH_ROOT, ghosttyPatches, ghostty.dir);
  await applyPatches(PATCH_ROOT, wtermPatches, wrapper.dir);

  const prefix = join(work, "out");
  await run("zig", [zig, "build", `-Doptimize=${OPTIMIZE}`, "--prefix", prefix], wrapper.dir, {
    ZIG_GLOBAL_CACHE_DIR: join(work, "zig-global-cache"),
    ZIG_LOCAL_CACHE_DIR: join(work, "zig-local-cache"),
  });

  const wasm = await Bun.file(join(prefix, "bin", "ghostty-vt.wasm")).bytes();
  await mkdir(join(PACKAGE_ROOT, "wasm"), { recursive: true });
  await Bun.write(WASM_PATH, wasm);
  return {
    ghosttyTag: revision.tag,
    ghosttyCommit: revision.commit,
    ghosttyArchiveSha256: ghostty.archiveSha256,
    wtermTag: WTERM.tag,
    wtermCommit: WTERM.commit,
    wtermArchiveSha256: wrapper.archiveSha256,
    zig: ZIG_VERSION,
    optimize: OPTIMIZE,
    patches: await patchRecords([...ghosttyPatches, ...wtermPatches]),
    sha256: sha256Hex(wasm),
    bytes: wasm.byteLength,
  };
}

const work = await mkdtemp(join(tmpdir(), "ghostty-wasm-"));
try {
  const info = await build(work);
  await Bun.write(BUILD_JSON_PATH, `${JSON.stringify(info, null, 2)}\n`);
  console.log(`wrote ${info.bytes} bytes, sha256 ${info.sha256}`);
} finally {
  if (values.keep) console.log(`kept ${work}`);
  else await rm(work, { recursive: true, force: true });
}
