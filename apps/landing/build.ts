// Builds dist/ for doriterm.com: the page with its live mocks rendered from the app's own components, one hashed
// stylesheet per surface, hashed images, and the files Cloudflare serves verbatim.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { renderMocks, type Mocks } from "./src/mock/render.tsx";

const root = import.meta.dir;
const source = join(root, "src");
const assetDir = join(source, "assets");
const staticDir = join(source, "static");
const dist = join(root, "dist");
const scratch = join(dist, ".mock-css");

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

function injectMocks(html: string, mocks: Mocks): string {
  let output = html;
  const entries: readonly (readonly [string, { readonly day: string; readonly night: string }])[] =
    Object.entries(mocks);
  for (const [name, theme] of entries) {
    const placeholder = `<!-- mock:${name} -->`;
    if (!output.includes(placeholder)) throw new Error(`the page has no ${placeholder} placeholder`);
    output = output.replaceAll(placeholder, `${theme.day}${theme.night}`);
  }
  const leftover = output.match(/<!-- mock:[a-z]+ -->/);
  if (leftover !== null) throw new Error(`the page asks for a mock that does not exist: ${leftover[0]}`);
  return output;
}

function requireSizedImages(html: string): void {
  const tags = html.match(/<img\b[^>]*>/g) ?? [];
  const unsized = tags.filter((tag) => !/\swidth="/.test(tag) || !/\sheight="/.test(tag));
  if (unsized.length > 0) {
    throw new Error(`an image has no width and height, so the page would shift while loading:\n${unsized.join("\n")}`);
  }
}

/** Tailwind v4 over the app's tokens and the mock's own sources, so the real components keep their classes. */
async function compileMocks(markup: string): Promise<string> {
  await rm(scratch, { recursive: true, force: true });
  await mkdir(scratch, { recursive: true });
  await writeFile(join(scratch, "markup.html"), markup);
  const tailwind = [
    join(root, "node_modules/.bin/tailwindcss"),
    join(root, "../../node_modules/.bin/tailwindcss"),
  ].find((path) => existsSync(path));
  if (tailwind === undefined) throw new Error("the tailwind CLI is not installed");
  const run = Bun.spawn([tailwind, "-i", join(source, "mock.css"), "-o", join(scratch, "mock.css"), "--minify"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = await new Response(run.stderr).text();
  if ((await run.exited) !== 0) throw new Error(`tailwind failed: ${stderr}`);
  return readFile(join(scratch, "mock.css"), "utf8");
}

async function build(): Promise<void> {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  const copied = await copyStatics();
  const emitted = await emitAssets();
  const seen = new Map<string, number>();

  const mocks = renderMocks({ light: "/assets/mark-light.svg", dark: "/assets/mark-dark.svg" });
  const html = rewriteAssetPaths(injectMocks(await readFile(join(source, "index.html"), "utf8"), mocks), emitted, seen);
  const css = rewriteAssetPaths(await readFile(join(source, "styles.css"), "utf8"), emitted, seen);

  const unused = [...emitted.keys()].filter((original) => !seen.has(original));
  if (unused.length > 0) throw new Error(`these assets are never referenced: ${unused.join(", ")}`);

  requireSizedImages(html);

  const card = pngSize(await readFile(join(staticDir, "og.png")));
  if (card.width !== 1200 || card.height !== 630) {
    throw new Error(`og.png is ${String(card.width)}x${String(card.height)}; the social card must be 1200x630`);
  }

  const mockCss = await compileMocks(
    Object.values(mocks)
      .map((theme) => `${theme.day}${theme.night}`)
      .join(""),
  );
  const mockCssName = `assets/mock.${digest(new TextEncoder().encode(mockCss))}.css`;
  await writeFile(join(dist, mockCssName), mockCss);

  const cssName = `styles.${digest(new TextEncoder().encode(css))}.css`;
  const page = html
    .replace(
      '<link rel="stylesheet" href="/styles.css" />',
      `<link rel="stylesheet" href="/${mockCssName}" /><link rel="stylesheet" href="/${cssName}" />`,
    )
    .replace("/styles.css", `/${cssName}`);
  if (page.includes("/styles.css")) throw new Error("the stylesheet link was not rewritten");
  await writeFile(join(dist, cssName), css);
  await writeFile(join(dist, "index.html"), page);
  await rm(scratch, { recursive: true, force: true });

  const names = [...copied, cssName, mockCssName, "index.html", ...emitted.values()].toSorted();
  const sizes = await Promise.all(names.map(async (name) => (await readFile(join(dist, name))).byteLength));
  const total = sizes.reduce((sum, bytes) => sum + bytes, 0);
  console.log(`dist/ ${(total / 1024).toFixed(1)} KiB across ${String(names.length)} files`);
  names.forEach((name, index) => {
    console.log(`  ${((sizes[index] ?? 0) / 1024).toFixed(1).padStart(7)} KiB  ${name}`);
  });
}

await build();
