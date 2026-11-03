import { mkdir } from "node:fs/promises";

export class BuildStepError extends Error {
  readonly step: string;

  constructor(step: string, detail: string) {
    super(`${step}: ${detail}`);
    this.name = "BuildStepError";
    this.step = step;
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

export type Download = {
  readonly path: string;
  readonly sha256: string;
};

export async function download(url: string, path: string, expectedSha256: string | null): Promise<Download> {
  const response = await fetch(url);
  if (!response.ok) throw new BuildStepError("download", `${url} returned ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const sha256 = sha256Hex(bytes);
  if (expectedSha256 !== null && sha256 !== expectedSha256) {
    throw new BuildStepError("download", `${url} sha256 ${sha256}, expected ${expectedSha256}`);
  }
  await Bun.write(path, bytes);
  return { path, sha256 };
}

export async function run(
  step: string,
  command: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string>> = {},
): Promise<void> {
  const child = Bun.spawn([...command], {
    cwd,
    env: { ...process.env, ...env },
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) throw new BuildStepError(step, `${command.join(" ")} exited with ${code}`);
}

export async function extract(archive: string, into: string): Promise<void> {
  await mkdir(into, { recursive: true });
  await run("extract", ["tar", "-xf", archive, "--strip-components=1", "-C", into], into);
}
