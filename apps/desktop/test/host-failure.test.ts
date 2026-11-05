import { describe, expect, test } from "bun:test";
import { STARTUP_ERROR_PREFIX, StartupError, startupErrorLine } from "../../host/src/startup-error.ts";
import { parseStartupError, STARTUP_ERROR_PREFIX as DESKTOP_PREFIX } from "../src/main/host-failure.ts";

describe("the desktop reads doriface-host's startup-error line", () => {
  test("with the host's own prefix, and every field the host writes", () => {
    expect(DESKTOP_PREFIX).toBe(STARTUP_ERROR_PREFIX);
    const line = startupErrorLine(
      new StartupError("port-in-use", "127.0.0.1:1 is already in use", { address: "127.0.0.1:1", path: "/s" }),
    );
    expect(parseStartupError(line)).toEqual({
      code: "port-in-use",
      message: "127.0.0.1:1 is already in use",
      address: "127.0.0.1:1",
      path: "/s",
    });
  });
});
