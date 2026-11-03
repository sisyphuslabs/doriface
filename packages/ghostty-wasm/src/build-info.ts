export type PatchRecord = {
  readonly path: string;
  readonly sha256: string;
};

export type BuildInfo = {
  readonly ghosttyTag: string;
  readonly ghosttyCommit: string;
  readonly ghosttyArchiveSha256: string;
  readonly wtermTag: string;
  readonly wtermCommit: string;
  readonly wtermArchiveSha256: string;
  readonly zig: string;
  readonly optimize: string;
  readonly patches: readonly PatchRecord[];
  readonly sha256: string;
  readonly bytes: number;
};

export class BuildInfoError extends Error {
  readonly field: string;

  constructor(field: string, problem: string) {
    super(`build.json: ${field} ${problem}`);
    this.name = "BuildInfoError";
    this.field = field;
  }
}

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const PATCH_PATH = /^patches\/(?:ghostty|wterm)\/[\w.-]+\.patch$/;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(source: Readonly<Record<string, unknown>>, field: string, pattern?: RegExp, at = field): string {
  const value = source[field];
  if (typeof value !== "string" || value.length === 0) throw new BuildInfoError(at, "must be a non-empty string");
  if (pattern !== undefined && !pattern.test(value)) throw new BuildInfoError(at, `must match ${pattern.source}`);
  return value;
}

function patchRecord(value: unknown, index: number): PatchRecord {
  if (!isRecord(value)) throw new BuildInfoError(`patches[${index}]`, "must be an object");
  return {
    path: text(value, "path", PATCH_PATH, `patches[${index}].path`),
    sha256: text(value, "sha256", SHA256, `patches[${index}].sha256`),
  };
}

export function parseBuildInfo(value: unknown): BuildInfo {
  if (!isRecord(value)) throw new BuildInfoError("root", "must be an object");
  const patches = value["patches"];
  if (!Array.isArray(patches)) throw new BuildInfoError("patches", "must be an array");
  const bytes = value["bytes"];
  if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new BuildInfoError("bytes", "must be a positive integer");
  }
  return {
    ghosttyTag: text(value, "ghosttyTag"),
    ghosttyCommit: text(value, "ghosttyCommit", COMMIT),
    ghosttyArchiveSha256: text(value, "ghosttyArchiveSha256", SHA256),
    wtermTag: text(value, "wtermTag"),
    wtermCommit: text(value, "wtermCommit", COMMIT),
    wtermArchiveSha256: text(value, "wtermArchiveSha256", SHA256),
    zig: text(value, "zig"),
    optimize: text(value, "optimize"),
    patches: patches.map(patchRecord),
    sha256: text(value, "sha256", SHA256),
    bytes,
  };
}
