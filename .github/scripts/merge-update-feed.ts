// The update feed electron-updater reads from a GitHub release: latest-mac.yml, latest.yml (Windows),
// latest-linux.yml and latest-linux-arm64.yml. Each desktop runner builds one OS and one CPU, so the two macOS runners
// each write a latest-mac.yml and the two Windows runners each write a latest.yml. A release carries one file per name,
// listing every architecture's download; the updater picks its own by file name (MacUpdater.filterFilesForArch on
// "arm64", Provider.findFile on process.arch). This merges the runners' copies into one file per name in the assets
// directory, after checking that every file a feed names is in the directory at the size and SHA-512 the feed says.
//
// usage: bun .github/scripts/merge-update-feed.ts <assets dir>
// Reads <assets dir>/feed-<os>-<arch>/latest*.yml, writes <assets dir>/latest*.yml and removes the feed-* directories.
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type FeedFile = { url: string; sha512: string; size: number; [key: string]: unknown };
type Feed = { version: string; files: FeedFile[]; path?: string; sha512?: string; releaseDate?: string };

function fail(message: string): never {
  console.error(`merge-update-feed: ${message}`);
  process.exit(1);
}

function readFeed(file: string): Feed {
  const parsed: unknown = Bun.YAML.parse(readFileSync(file, "utf8"));
  if (typeof parsed !== "object" || parsed === null) fail(`${file} is not a YAML mapping`);
  const feed = parsed as Partial<Feed>;
  if (typeof feed.version !== "string" || !Array.isArray(feed.files) || feed.files.length === 0) {
    fail(`${file} has no version or no files`);
  }
  return feed as Feed;
}

function sha512(file: string): string {
  return new Bun.CryptoHasher("sha512").update(readFileSync(file)).digest("base64");
}

const assetsDir = Bun.argv[2];
if (assetsDir === undefined) {
  console.error("usage: bun .github/scripts/merge-update-feed.ts <assets dir>");
  process.exit(2);
}

const feedDirs = readdirSync(assetsDir)
  .filter((name) => name.startsWith("feed-") && statSync(join(assetsDir, name)).isDirectory())
  .toSorted();
if (feedDirs.length === 0) fail(`no feed-* directory in ${assetsDir}`);

const byName = new Map<string, Feed[]>();
for (const dir of feedDirs) {
  const names = readdirSync(join(assetsDir, dir)).filter((name) => /^latest.*\.yml$/.test(name));
  if (names.length === 0) fail(`${dir} has no latest*.yml`);
  for (const name of names) byName.set(name, [...(byName.get(name) ?? []), readFeed(join(assetsDir, dir, name))]);
}

for (const [name, feeds] of [...byName].toSorted(([a], [b]) => a.localeCompare(b))) {
  const versions = new Set(feeds.map((feed) => feed.version));
  if (versions.size !== 1) fail(`${name}: the runners disagree on the version (${[...versions].join(", ")})`);
  const files = new Map<string, FeedFile>();
  for (const file of feeds.flatMap((feed) => feed.files)) {
    if (files.has(file.url)) fail(`${name}: ${file.url} is listed twice`);
    files.set(file.url, file);
  }
  for (const file of files.values()) {
    const path = join(assetsDir, file.url);
    if (!existsSync(path)) fail(`${name} names ${file.url}, which is not among the release's files`);
    if (statSync(path).size !== file.size)
      fail(`${name}: ${file.url} is ${statSync(path).size} bytes, the feed says ${file.size}`);
    if (sha512(path) !== file.sha512) fail(`${name}: ${file.url} does not match the feed's sha512`);
  }
  const [first] = feeds;
  const merged: Feed = { ...first, files: [...files.values()] };
  writeFileSync(join(assetsDir, name), Bun.YAML.stringify(merged, null, 2) + "\n");
  console.log(`${name}: version ${first.version}, ${[...files.keys()].join(", ")}`);
}

for (const dir of feedDirs) rmSync(join(assetsDir, dir), { recursive: true });
