import { describe, expect, test } from "bun:test";
import { hostStartCopy } from "./host-start-copy.ts";

const failure = (code: string, extra: object = {}) => ({ code, message: "m", details: "d", ...extra });

describe("host start copy", () => {
  test("a doriface-host that could not run says so and points at reinstalling, not at a host that stopped", () => {
    const copy = hostStartCopy(failure("host-spawn-failed"));
    expect(copy.cause).toBe("doriface could not run its host program.");
    expect(copy.next).toContain("Reinstall doriface");
    expect(copy.cause).not.toContain("stopped");
  });

  test("herdr-core not found lists the folders this computer searched, and asks for nothing a desktop app cannot read", () => {
    const windows = ["C:\\Users\\q\\.local\\bin", "C:\\Users\\q\\.cargo\\bin"];
    const copy = hostStartCopy(failure("hc-binary-missing", { path: "hc", searched: windows }));
    expect(copy.next).toBe(
      "doriface looks for hc on your PATH and in C:\\Users\\q\\.local\\bin and C:\\Users\\q\\.cargo\\bin. Install herdr-core in one of them, then retry.",
    );
    expect(copy.install).toBe(true);
  });

  test("herdr-core not found with no searched folders names only the PATH, and never HC_BIN", () => {
    const copy = hostStartCopy(failure("hc-binary-missing", { path: "hc" }));
    expect(copy.next).toBe("doriface looks for hc on your PATH. Install herdr-core there, then retry.");
    expect(copy.next).not.toContain("/opt/homebrew");
  });

  test("an herdr-core older than the host needs asks for an update, with the install link (#406)", () => {
    const copy = hostStartCopy(failure("hc-too-old", { path: "C:\\tools\\hc.exe" }));
    expect(copy.cause).toContain("C:\\tools\\hc.exe");
    expect(copy.next).toContain("0.1.17");
    expect(copy.install).toBe(true);
  });
});
