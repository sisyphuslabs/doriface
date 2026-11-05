import { HOST_INFO_DOC } from "@doriface/protocol";
import { describe, expect, test } from "bun:test";
import { platformOf, readHostOs } from "./host-os.ts";

describe("platformOf", () => {
  test("a host that reported darwin is a mac, whatever its name", () => {
    expect(platformOf("darwin", "studio")).toBe("mac");
  });

  test("a host that reported linux or win32 is not, even when its name says mac", () => {
    expect(platformOf("linux", "Alexs-MacBook-Pro")).toBe("other");
    expect(platformOf("win32", "buildMac")).toBe("other");
  });

  test("a host that reported nothing (an older one) falls back to the name's guess", () => {
    expect(platformOf(undefined, "Alexs-MacBook-Pro")).toBe("mac");
    expect(platformOf(undefined, "studio")).toBe("other");
  });
});

describe("readHostOs", () => {
  const calls: unknown[] = [];
  const answering = (value: unknown) => ({
    call: async (method: string, params: unknown) => {
      calls.push({ method, params });
      return { value, version: 1 };
    },
  });

  test("reads this core's document for a local terminal, and the machine's for one on another machine", async () => {
    calls.length = 0;
    const connection = answering({ v: 1, os: "darwin" }) as never;
    expect(await readHostOs(connection, undefined)).toBe("darwin");
    expect(await readHostOs(connection, "studio")).toBe("darwin");
    expect(calls).toEqual([
      { method: "doc.get", params: { name: HOST_INFO_DOC } },
      { method: "doc.get", params: { name: HOST_INFO_DOC, on: "studio" } },
    ]);
  });

  test("no document, or a read that fails (an offline machine), reports nothing", async () => {
    expect(await readHostOs(answering(null) as never, undefined)).toBeUndefined();
    const failing = { call: async () => Promise.reject(new Error("studio is offline")) };
    expect(await readHostOs(failing as never, "studio")).toBeUndefined();
  });
});
