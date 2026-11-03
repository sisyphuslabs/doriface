import { join } from "node:path";

/** electron-builder's `${os}-${arch}` resource directory -> bun's compile target. */
const TARGETS = {
  "mac-arm64": "bun-darwin-arm64",
  "mac-x64": "bun-darwin-x64",
  "linux-x64": "bun-linux-x64",
  "linux-arm64": "bun-linux-arm64",
  "win-x64": "bun-windows-x64",
  "win-arm64": "bun-windows-arm64",
} as const;

type Target = keyof typeof TARGETS;

const isTarget = (value: string): value is Target => Object.hasOwn(TARGETS, value);
const OS_NAMES: Readonly<Record<string, string>> = { darwin: "mac", linux: "linux", win32: "win" };

const root = join(import.meta.dir, "..");
const cli = join(root, "..", "host", "src", "cli.ts");
const requested = Bun.argv.slice(2);
const names = requested.includes("all")
  ? Object.keys(TARGETS)
  : requested.length > 0
    ? requested
    : [`${OS_NAMES[process.platform] ?? process.platform}-${process.arch}`];

const unknown = names.filter((name) => !isTarget(name));
if (unknown.length > 0) {
  console.error(`unknown host target ${unknown.join(", ")}; expected all or one of ${Object.keys(TARGETS).join(", ")}`);
  process.exit(2);
}

const compile = async (name: Target): Promise<number> => {
  const outfile = join(root, "dist", "host", name, name.startsWith("win-") ? "doriface-host.exe" : "doriface-host");
  const proc = Bun.spawn(["bun", "build", "--compile", `--target=${TARGETS[name]}`, cli, "--outfile", outfile], {
    stdout: "inherit",
    stderr: "inherit",
  });
  return proc.exited;
};

const codes = await Promise.all(names.filter(isTarget).map(compile));
if (codes.some((code) => code !== 0)) process.exit(1);
