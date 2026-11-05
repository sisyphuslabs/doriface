import { HcRpcError, type JsonValue } from "@doriface/protocol";
import { describe, expect, test } from "bun:test";
import { publishHostInfo, writeHostInfo } from "./host-info.ts";

const conflict = () => new HcRpcError({ code: -32000, message: "version moved", data: { kind: "conflict" } });

/** A core whose document says linux and moves to a new version on each read; it refuses the first `conflicts` sets. */
function core(conflicts: number) {
  const sets: { readonly value: JsonValue; readonly version: number }[] = [];
  let reads = 0;
  let refused = 0;
  const call = async (method: string, params: { value?: JsonValue; version?: number }) => {
    if (method === "doc.get") {
      reads += 1;
      return { value: { v: 1, os: "linux" }, version: reads };
    }
    sets.push({ value: params.value ?? null, version: params.version ?? 0 });
    if (refused < conflicts) {
      refused += 1;
      throw conflict();
    }
    return { version: (params.version ?? 0) + 1 };
  };
  return { connection: { call } as never, sets, reads: () => reads };
}

describe("writeHostInfo", () => {
  test("a conflict is read again and written once more, at the version the second read saw", async () => {
    const { connection, sets, reads } = core(1);
    expect(await writeHostInfo(connection, { v: 1, os: "darwin" })).toBe("written");
    expect(reads()).toBe(2);
    expect(sets).toEqual([
      { value: { v: 1, os: "darwin" }, version: 1 },
      { value: { v: 1, os: "darwin" }, version: 2 },
    ]);
  });

  test("a second conflict is not retried again", async () => {
    const { connection, sets } = core(2);
    await expect(writeHostInfo(connection, { v: 1, os: "darwin" })).rejects.toThrow("version moved");
    expect(sets).toHaveLength(2);
  });

  test("a document that already says this OS is left as it is", async () => {
    const { connection, sets } = core(0);
    expect(await writeHostInfo(connection, { v: 1, os: "linux" })).toBe("unchanged");
    expect(sets).toEqual([]);
  });
});

describe("publishHostInfo", () => {
  test("stop() during a write the core never answers closes the child, and settles once it exited", async () => {
    const closes = new Set<(error: Error | undefined) => void>();
    let closed = false;
    // A core that never answers the hello: only closing the child ends the write.
    const silent = {
      send: () => {},
      onData: () => () => {},
      onClose: (listener: (error: Error | undefined) => void) => {
        closes.add(listener);
        return () => closes.delete(listener);
      },
      close: () => {
        closed = true;
        queueMicrotask(() => closes.forEach((listener) => listener(undefined)));
      },
    };
    const logs: string[] = [];
    const publisher = publishHostInfo(
      { hc: "hc" },
      "darwin",
      (line) => logs.push(line),
      () => silent,
    );
    const stopped = publisher.stop();
    expect(closed).toBe(true);
    await stopped;
    await publisher.settled;
    expect(logs).toEqual([]);
  });

  test("kill ends a write's child that closing its stdin did not, and names its pid; a child already gone is not killed", async () => {
    const closes = new Set<(error: Error | undefined) => void>();
    const signals: string[] = [];
    // A core that never answers and ignores a closed stdin: only a kill ends it.
    const hung = {
      pid: 4545,
      send: () => {},
      onData: () => () => {},
      onClose: (listener: (error: Error | undefined) => void) => {
        closes.add(listener);
        return () => closes.delete(listener);
      },
      close: () => {},
      kill: (signal: "SIGKILL") => {
        signals.push(signal);
        for (const listener of closes) listener(new Error("killed"));
      },
    };
    const publisher = publishHostInfo(
      { hc: "hc" },
      "darwin",
      () => {},
      () => hung,
    );
    const stopped = publisher.stop();
    expect(publisher.kill()).toEqual([4545]);
    expect(signals).toEqual(["SIGKILL"]);
    await stopped;
    expect(publisher.kill()).toEqual([]);
    expect(signals).toEqual(["SIGKILL"]);
  });
});
