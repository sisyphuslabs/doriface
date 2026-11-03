import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

export interface HostCommand {
  readonly file: string;
  readonly args: readonly string[];
}

export interface HostContext {
  readonly packaged: boolean;
  readonly resourcesPath: string;
  readonly appPath: string;
  readonly platform: NodeJS.Platform;
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

const executable = (name: string, platform: NodeJS.Platform): string => (platform === "win32" ? `${name}.exe` : name);

const isExecutable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** Packaged builds ship a compiled doriface-host; a checkout runs the workspace source with bun. */
export function hostCommand(context: HostContext): HostCommand {
  const override = context.env["DORIFACE_HOST_BIN"];
  if (override !== undefined && override !== "") return { file: override, args: [] };
  if (context.packaged) {
    return { file: join(context.resourcesPath, "bin", executable("doriface-host", context.platform)), args: [] };
  }
  return { file: context.env["BUN_BIN"] ?? "bun", args: [join(context.appPath, "..", "host", "src", "cli.ts")] };
}

/**
 * Finds herdr-core. Apps launched from a desktop session inherit a minimal PATH, so the usual install
 * directories are searched after it.
 */
export function findHc(context: HostContext): string | undefined {
  const pinned = context.env["HC_BIN"];
  if (pinned !== undefined && pinned !== "") return pinned;
  const fromPath = (context.env["PATH"] ?? "").split(delimiter).filter((dir) => dir !== "");
  const usual =
    context.platform === "win32"
      ? [join(context.home, ".local", "bin"), join(context.home, ".cargo", "bin")]
      : [
          join(context.home, ".local", "bin"),
          join(context.home, ".cargo", "bin"),
          "/opt/homebrew/bin",
          "/usr/local/bin",
        ];
  const name = executable("hc", context.platform);
  return [...fromPath, ...usual].map((dir) => join(dir, name)).find(isExecutable);
}
