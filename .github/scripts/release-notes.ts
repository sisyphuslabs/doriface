#!/usr/bin/env bun
/**
 * Writes the release notes for a version to stdout: the CHANGELOG.md section for that version when there is one,
 * then the downloads in the assets directory and how to open unsigned builds.
 *
 * Usage: bun .github/scripts/release-notes.ts <version> <assets dir>
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CHANGELOG = join(import.meta.dir, "..", "..", "CHANGELOG.md");

interface Download {
  readonly label: string;
  readonly matches: (name: string) => boolean;
}

const has = (name: string, ...parts: readonly string[]): boolean => parts.every((part) => name.includes(part));
const isArm = (name: string): boolean => name.includes("arm64") || name.includes("aarch64");

const DOWNLOADS: readonly Download[] = [
  { label: "macOS, Apple silicon", matches: (name) => isArm(name) && (name.endsWith(".dmg") || has(name, "-mac.zip")) },
  { label: "macOS, Intel", matches: (name) => !isArm(name) && (name.endsWith(".dmg") || has(name, "-mac.zip")) },
  { label: "Windows x64", matches: (name) => !isArm(name) && name.endsWith(".exe") },
  { label: "Windows arm64", matches: (name) => isArm(name) && name.endsWith(".exe") },
  { label: "Linux x64", matches: (name) => !isArm(name) && (name.endsWith(".AppImage") || name.endsWith(".deb")) },
  { label: "Linux arm64", matches: (name) => isArm(name) && (name.endsWith(".AppImage") || name.endsWith(".deb")) },
  { label: "Web client and PWA (static files)", matches: (name) => has(name, "-web-") && name.endsWith(".zip") },
];

const escapeRegExp = (text: string): string => text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The lines under a `## <version>`, `## v<version>` or `## [<version>]` heading, up to the next `## ` heading. */
function changelogSection(version: string): string | undefined {
  if (!existsSync(CHANGELOG)) return undefined;
  const heading = new RegExp(`^##\\s+\\[?v?${escapeRegExp(version)}\\]?(?:\\s|$)`);
  const lines = readFileSync(CHANGELOG, "utf8").split(/\r?\n/);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  const body = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
  return body === "" ? undefined : body;
}

function downloads(assets: readonly string[]): string {
  const rows = DOWNLOADS.flatMap((download) => {
    const names = assets.filter(download.matches);
    return names.length === 0 ? [] : [`- **${download.label}:** ${names.map((name) => `\`${name}\``).join(", ")}`];
  });
  return [...rows, "- `SHA256SUMS.txt` lists the SHA-256 of every file (`sha256sum --check SHA256SUMS.txt`)."].join(
    "\n",
  );
}

const UNSIGNED = `## Unsigned builds

These builds are not code signed yet.

- **macOS:** ad-hoc signed and not notarized, so macOS blocks the first open. After moving doriface to Applications, choose **Open Anyway** in System Settings > Privacy & Security, or run \`xattr -dr com.apple.quarantine /Applications/doriface.app\`.
- **Windows:** SmartScreen warns about an unknown publisher. Choose **More info**, then **Run anyway**.
- **Linux:** make the AppImage executable (\`chmod +x\`) and run it, or install the deb with \`sudo apt install ./<file>.deb\`.`;

const [version, assetsDir] = Bun.argv.slice(2);
if (version === undefined || assetsDir === undefined) {
  console.error("usage: bun .github/scripts/release-notes.ts <version> <assets dir>");
  process.exit(2);
}

const assets = readdirSync(assetsDir)
  .filter((name) => name !== "SHA256SUMS.txt")
  .toSorted();
const changes = changelogSection(version) ?? "No CHANGELOG.md section for this version.";
console.log([`# doriface v${version}`, changes, `## Downloads\n\n${downloads(assets)}`, UNSIGNED].join("\n\n"));
