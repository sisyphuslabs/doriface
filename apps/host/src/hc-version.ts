/** The oldest herdr-core this host speaks to: its protocol generation is hc 0.1.17's (`e2ee/hc-line.ts`). */
export const MIN_HC_VERSION = "0.1.17";

const NUMBER = "0|[1-9]\\d{0,8}";
const IDENTIFIER = `(?:${NUMBER}|\\d*[A-Za-z-][0-9A-Za-z-]*)`;
/**
 * `hc --version` as Semantic Versioning 2.0.0 writes a version: no leading zeros in the core numbers or in numeric
 * prerelease identifiers, no empty identifier, and core numbers short enough to stay exact as numbers.
 */
const VERSION_LINE = new RegExp(
  `^hc ((?:${NUMBER})\\.(?:${NUMBER})\\.(?:${NUMBER})(?:-${IDENTIFIER}(?:\\.${IDENTIFIER})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?)$`,
);

/** The version in one `hc --version` line, e.g. "0.1.17"; undefined for anything that is not a version. */
export function parseHcVersionLine(line: string): string | undefined {
  return VERSION_LINE.exec(line.trim())?.[1];
}

interface Parsed {
  readonly core: readonly [number, number, number];
  readonly prerelease: readonly string[];
}

function parse(version: string): Parsed {
  const [withoutBuild = ""] = version.split("+");
  const dash = withoutBuild.indexOf("-");
  const core = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash);
  const [major = 0, minor = 0, patch = 0] = core.split(".").map(Number);
  return { core: [major, minor, patch], prerelease: dash === -1 ? [] : withoutBuild.slice(dash + 1).split(".") };
}

const numeric = (identifier: string): boolean => /^\d+$/.test(identifier);

function compareIdentifiers(a: string, b: string): number {
  if (numeric(a) && numeric(b)) return Number(a) - Number(b);
  if (numeric(a)) return -1;
  if (numeric(b)) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Semantic Versioning precedence: below zero when `a` comes before `b`; build metadata is ignored. */
export function compareVersions(a: string, b: string): number {
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left.core[index] ?? 0) - (right.core[index] ?? 0);
    if (difference !== 0) return difference;
  }
  // A release comes after every prerelease of it.
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return right.prerelease.length - left.prerelease.length;
  }
  for (let index = 0; index < Math.min(left.prerelease.length, right.prerelease.length); index += 1) {
    const difference = compareIdentifiers(left.prerelease[index] ?? "", right.prerelease[index] ?? "");
    if (difference !== 0) return difference;
  }
  return left.prerelease.length - right.prerelease.length;
}

/** Whether `version` is at least {@link MIN_HC_VERSION}; a prerelease of 0.1.17 is not. */
export const meetsHcFloor = (version: string): boolean => compareVersions(version, MIN_HC_VERSION) >= 0;
