#!/usr/bin/env bun
/**
 * Resolves the version a release builds, from a tag (v1.2.3) or a dispatch input (1.2.3 or v1.2.3), and fails unless
 * it is the version in apps/desktop/package.json, which is the single source of the release version. A prerelease of
 * that version (1.2.3-rc.1 against 1.2.3) is accepted too, so a candidate can be built without editing the file.
 *
 * Usage: bun .github/scripts/release-version.ts <tag or version>
 * Writes version, tag and prerelease to $GITHUB_OUTPUT when it is set.
 */
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const PACKAGE = join(import.meta.dir, "..", "..", "apps", "desktop", "package.json");

function fail(message: string): never {
  console.error(`::error title=Release version::${message}`);
  process.exit(1);
}

async function declaredVersion(): Promise<string> {
  const manifest: unknown = await Bun.file(PACKAGE).json();
  if (typeof manifest !== "object" || manifest === null) fail("apps/desktop/package.json is not a JSON object");
  const version: unknown = Reflect.get(manifest, "version");
  if (typeof version !== "string" || !SEMVER.test(version)) fail("apps/desktop/package.json has no X.Y.Z version");
  return version;
}

const raw = Bun.argv[2] ?? "";
const version = raw.startsWith("v") ? raw.slice(1) : raw;
if (!SEMVER.test(version)) {
  fail(`"${raw}" is not a release version; expected X.Y.Z or X.Y.Z-prerelease, such as 0.2.0 or 0.2.0-rc.1`);
}

const declared = await declaredVersion();
const prerelease = version.includes("-");
const matches = version === declared || (prerelease && !declared.includes("-") && version.startsWith(`${declared}-`));
if (!matches) {
  fail(
    `v${version} does not match apps/desktop/package.json, which says ${declared}. ` +
      `Set "version" there to ${version.split("-")[0]} and commit it before tagging, or release v${declared}.`,
  );
}

const outputs = { version, tag: `v${version}`, prerelease: String(prerelease) };
for (const [key, value] of Object.entries(outputs)) console.log(`${key}=${value}`);
const outputFile = process.env["GITHUB_OUTPUT"];
if (outputFile !== undefined && outputFile !== "") {
  appendFileSync(
    outputFile,
    Object.entries(outputs)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  );
}
