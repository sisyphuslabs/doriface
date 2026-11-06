// Builds dist/ for doriterm.com: hashed images and stylesheet, the page, and the files Cloudflare serves verbatim.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const root = import.meta.dir;
const source = join(root, "src");
const assetDir = join(source, "assets");
const staticDir = join(source, "static");
const dist = join(root, "dist");

const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex").slice(0, 8);

function hashedName(name: string, hash: string): string {
  const extension = extname(name);
  return `${name.slice(0, name.length - extension.length)}.${hash}${extension}`;
}

/** The width and height live at byte offsets 16 and 20 of a PNG's IHDR chunk. */
function pngSize(bytes: Uint8Array): { readonly width: number; readonly height: number } {
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: header.getUint32(16), height: header.getUint32(20) };
}

async function copyStatics(): Promise<readonly string[]> {
  const entries = (await readdir(staticDir, { withFileTypes: true })).filter((entry) => entry.isFile());
  await Promise.all(
    entries.map(async (entry) => {
      const bytes = await readFile(join(staticDir, entry.name));
      await writeFile(join(dist, entry.name), bytes);
    }),
  );
  return entries.map((entry) => entry.name).toSorted();
}

async function emitAssets(): Promise<ReadonlyMap<string, string>> {
  await mkdir(join(dist, "assets"), { recursive: true });
  const entries = (await readdir(assetDir, { withFileTypes: true })).filter((entry) => entry.isFile());
  const written = await Promise.all(
    entries.map(async (entry) => {
      const bytes = await readFile(join(assetDir, entry.name));
      const rewritten = hashedName(entry.name, digest(bytes));
      await writeFile(join(dist, "assets", rewritten), bytes);
      return [`assets/${entry.name}`, `assets/${rewritten}`] as const;
    }),
  );
  return new Map(written);
}

function rewriteAssetPaths(text: string, emitted: ReadonlyMap<string, string>, seen: Map<string, number>): string {
  let output = text;
  for (const [original, rewritten] of emitted) {
    const count = output.split(original).length - 1;
    if (count === 0) continue;
    seen.set(original, (seen.get(original) ?? 0) + count);
    output = output.split(original).join(rewritten);
  }
  return output;
}

function requireSizedImages(html: string): void {
  const tags = html.match(/<img\b[^>]*>/g) ?? [];
  const unsized = tags.filter((tag) => !/\swidth="/.test(tag) || !/\sheight="/.test(tag));
  if (unsized.length > 0) {
    throw new Error(`an image has no width and height, so the page would shift while loading:\n${unsized.join("\n")}`);
  }
}

async function build(): Promise<void> {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  const copied = await copyStatics();
  const emitted = await emitAssets();
  const seen = new Map<string, number>();

  const html = rewriteAssetPaths(await readFile(join(source, "index.html"), "utf8"), emitted, seen);
  const css = rewriteAssetPaths(await readFile(join(source, "styles.css"), "utf8"), emitted, seen);

  const unused = [...emitted.keys()].filter((original) => !seen.has(original));
  if (unused.length > 0) throw new Error(`these assets are never referenced: ${unused.join(", ")}`);

  requireSizedImages(html);

  const card = pngSize(await readFile(join(staticDir, "og.png")));
  if (card.width !== 1200 || card.height !== 630) {
    throw new Error(`og.png is ${String(card.width)}x${String(card.height)}; the social card must be 1200x630`);
  }

  const cssName = `styles.${digest(new TextEncoder().encode(css))}.css`;
  const page = html.replace("/styles.css", `/${cssName}`);
  if (page.includes("/styles.css")) throw new Error("the stylesheet link was not rewritten");
  await writeFile(join(dist, cssName), css);
  await writeFile(join(dist, "index.html"), page);

  const names = [...copied, cssName, "index.html", ...emitted.values()].toSorted();
  const sizes = await Promise.all(names.map(async (name) => (await readFile(join(dist, name))).byteLength));
  const total = sizes.reduce((sum, bytes) => sum + bytes, 0);
  console.log(`dist/ ${(total / 1024).toFixed(1)} KiB across ${String(names.length)} files`);
  names.forEach((name, index) => {
    console.log(`  ${((sizes[index] ?? 0) / 1024).toFixed(1).padStart(7)} KiB  ${name}`);
  });
}

await build();
