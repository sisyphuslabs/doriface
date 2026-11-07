import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "..", ".github", "scripts", "playwright-linux-deps.sh");

// The script runs on Ubuntu runners: it needs a bash with mapfile (4+), which macOS's /bin/bash is not.
const bash = Bun.spawnSync(["bash", "-c", "type mapfile"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
if (!bash) console.warn("playwright-linux-deps: skipped, the bash on PATH has no mapfile (bash 4+ needed)");

interface Apt {
  /** The candidate versions in the runner's package lists: what `install --no-download` asks the archive for. */
  readonly candidates: readonly string[];
  /** What the mirror serves when install-deps downloads. */
  readonly mirror: readonly string[];
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Runs the script against stub sudo, apt-get, dpkg-deb, bunx and timeout; package files are <package>_<version>.deb. */
function run(cached: readonly string[], apt: Apt): { save: string; cache: string[]; mirrorInstalls: number } {
  const root = mkdtempSync(join(tmpdir(), "pw-deps-"));
  dirs.push(root);
  const debs = join(root, "debs");
  const archives = join(root, "archives");
  const bin = join(root, "bin");
  const log = join(root, "calls.log");
  mkdirSync(bin);
  mkdirSync(archives);
  if (cached.length > 0) mkdirSync(debs);
  for (const deb of cached) writeFileSync(join(debs, deb), "");
  const stubs: Record<string, string> = {
    sudo: 'exec "$@"',
    timeout: 'shift; exec "$@"',
    "dpkg-deb": 'basename "$3" .deb | cut -d_ -f1',
    "apt-get": [
      `echo "apt-get $*" >> "${log}"`,
      `case " $* " in *" clean "*) rm -f "${archives}"/*.deb; exit 0 ;; esac`,
      `case " $* " in *" --no-download "*) for want in ${apt.candidates.join(" ")}; do [ -f "${archives}/$want.deb" ] || exit 100; done ;; esac`,
      "exit 0",
    ].join("\n"),
    bunx: [
      `echo "bunx $*" >> "${log}"`,
      `case " $* " in *" --dry-run "*) exit 0 ;; esac`,
      `for deb in ${apt.mirror.join(" ")}; do : > "${archives}/$deb.deb"; done`,
    ].join("\n"),
  };
  for (const [name, body] of Object.entries(stubs)) {
    writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const output = join(root, "github-output");
  const result = Bun.spawnSync(["bash", SCRIPT, debs], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env["PATH"] ?? ""}`,
      GITHUB_OUTPUT: output,
      PLAYWRIGHT_APT_ARCHIVES: archives,
      PLAYWRIGHT_APT_CONF: join(root, "99-playwright-ci"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(`script exited ${String(result.exitCode)}: ${result.stderr.toString()}`);
  const calls = existsSync(log) ? readFileSync(log, "utf8") : "";
  return {
    save: readFileSync(output, "utf8").trim(),
    cache: existsSync(debs) ? readdirSync(debs).toSorted() : [],
    mirrorInstalls: calls.split("\n").filter((line) => line.startsWith("bunx playwright install-deps chromium")).length,
  };
}

test.skipIf(!bash)("a cache that covers the runner's candidates installs without the mirror and is kept", () => {
  const found = run(["fonts-a_1.deb"], { candidates: ["fonts-a_1"], mirror: ["fonts-a_1"] });
  expect(found).toEqual({ save: "save-debs=false", cache: ["fonts-a_1.deb"], mirrorInstalls: 0 });
});

// doriterm#1022: an archive update makes the cached version stale; the mirror install that follows refills the cache.
test.skipIf(!bash)("a stale cache falls back to the mirror and is saved again with what the mirror served", () => {
  const found = run(["fonts-a_1.deb"], { candidates: ["fonts-a_2"], mirror: ["fonts-a_2"] });
  expect(found).toEqual({ save: "save-debs=true", cache: ["fonts-a_2.deb"], mirrorInstalls: 1 });
});

test.skipIf(!bash)("an empty cache is filled from the mirror", () => {
  const found = run([], { candidates: ["fonts-a_1"], mirror: ["fonts-a_1"] });
  expect(found).toEqual({ save: "save-debs=true", cache: ["fonts-a_1.deb"], mirrorInstalls: 1 });
});
