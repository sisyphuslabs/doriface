import { cp, readdir } from "node:fs/promises";
import { join } from "node:path";
import { BuildStepError, download, extract, run } from "./artifacts.ts";
import { GHOSTTY, WTERM, ZIG_SHA256, ZIG_VERSION, codeloadUrl, zigUrl } from "./pins.ts";
import type { ZigHost } from "./pins.ts";

export type GhosttyRevision = {
  readonly tag: string;
  readonly commit: string;
  readonly archiveSha256: string | null;
};

export type FetchedSource = {
  readonly dir: string;
  readonly archiveSha256: string;
};

const COMMIT = /^[0-9a-f]{40}$/;

/** Unpinned refs resolve through the GitHub API; their archive digest is recorded, not checked. */
export async function resolveGhostty(ref: string): Promise<GhosttyRevision> {
  if (ref === GHOSTTY.tag || ref === GHOSTTY.commit) return GHOSTTY;
  const response = await fetch(`https://api.github.com/repos/${GHOSTTY.repository}/commits/${ref}`, {
    headers: { accept: "application/vnd.github.sha" },
  });
  const commit = (await response.text()).trim();
  if (!response.ok || !COMMIT.test(commit)) throw new BuildStepError("resolve", `cannot resolve ghostty ref ${ref}`);
  return { tag: ref, commit, archiveSha256: null };
}

export async function fetchGhostty(revision: GhosttyRevision, work: string): Promise<FetchedSource> {
  const archive = join(work, "ghostty.tar.gz");
  const fetched = await download(codeloadUrl(GHOSTTY.repository, revision.commit), archive, revision.archiveSha256);
  const dir = join(work, "ghostty");
  await extract(archive, dir);
  return { dir, archiveSha256: fetched.sha256 };
}

export async function fetchWrapper(work: string): Promise<FetchedSource> {
  const archive = join(work, "wterm.tar.gz");
  const fetched = await download(codeloadUrl(WTERM.repository, WTERM.commit), archive, WTERM.archiveSha256);
  const tree = join(work, "wterm");
  await extract(archive, tree);
  const dir = join(work, "wrapper");
  await cp(join(tree, WTERM.wrapperDir), dir, { recursive: true });
  return { dir, archiveSha256: fetched.sha256 };
}

function zigHost(): ZigHost {
  const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : null;
  const os = process.platform === "darwin" ? "macos" : process.platform === "linux" ? "linux" : null;
  if (arch === null || os === null) {
    throw new BuildStepError("zig", `no pinned Zig for ${process.platform}-${process.arch}`);
  }
  return `${arch}-${os}`;
}

export async function installZig(work: string): Promise<string> {
  const host = zigHost();
  const archive = join(work, "zig.tar.xz");
  await download(zigUrl(host), archive, ZIG_SHA256[host]);
  const dir = join(work, "zig");
  await extract(archive, dir);
  return join(dir, "zig");
}

export async function assertZigMatchesGhostty(ghosttyDir: string): Promise<void> {
  const manifest = await Bun.file(join(ghosttyDir, "build.zig.zon")).text();
  const required = /\.minimum_zig_version\s*=\s*"([^"]+)"/.exec(manifest)?.[1];
  if (required !== ZIG_VERSION) {
    throw new BuildStepError("zig", `ghostty requires Zig ${required ?? "unknown"}, pinned ${ZIG_VERSION}`);
  }
}

export async function listPatches(patchRoot: string, group: "ghostty" | "wterm"): Promise<readonly string[]> {
  const names = (await readdir(join(patchRoot, group))).filter((name) => name.endsWith(".patch")).toSorted();
  return names.map((name) => join(group, name));
}

export function applyPatches(patchRoot: string, patches: readonly string[], target: string): Promise<void> {
  return patches.reduce(
    (applied, patch) =>
      applied.then(() => run("patch", ["patch", "-p1", "--forward", "--batch", "-i", join(patchRoot, patch)], target)),
    Promise.resolve(),
  );
}
