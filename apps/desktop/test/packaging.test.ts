import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * What a Linux user needs before the AppImage opens is decided by the runtime electron-builder embeds, not by the app.
 * Its legacy runtime dlopen()s libfuse.so.2; the toolset named by `toolsets.appimage` is the statically linked one,
 * which carries FUSE itself. Stock Ubuntu 24.04 ships FUSE 3 and no libfuse.so.2, so the legacy runtime is exactly the
 * "dlopen(): error loading libfuse.so.2" a 24.04 user hit. The release workflow proves the launch on a runner whose
 * libfuse.so.2 is asserted absent; this test guards the config that would silently undo it at release time.
 */
const builder = JSON.parse(readFileSync(join(import.meta.dir, "..", "electron-builder.json"), "utf8")) as {
  readonly toolsets?: { readonly appimage?: string };
  readonly appImage?: { readonly executableArgs?: readonly string[] };
};

describe("packaging the AppImage", () => {
  test("the AppImage is built with the static runtime, so it needs no libfuse.so.2", () => {
    // electron-builder builds the FUSE 2 legacy runtime when toolsets.appimage is unset or "0.0.0".
    expect(builder.toolsets?.appimage).toBeString();
    expect(builder.toolsets?.appimage).not.toBe("0.0.0");
  });

  test("the AppImage desktop entry keeps --no-sandbox, which Ubuntu 24.04's AppArmor user-namespace restriction needs", () => {
    // The legacy toolset put this argument in the AppImage's desktop entry by default and the static toolset does not.
    // It stays on the AppImage target only: the deb's entry never carried it.
    expect(builder.appImage?.executableArgs).toContain("--no-sandbox");
  });
});
