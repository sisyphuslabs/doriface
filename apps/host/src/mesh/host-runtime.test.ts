import { describe, expect, test } from "bun:test";
import type { HcControl, HcTarget } from "./hc-machines.ts";
import { HostStoppedError, lazyMachines } from "./host-runtime.ts";

const target: HcTarget = { hc: "hc", session: "s" };

/** Counts every control connection opened, as each one is an `hc connect` that starts the core when none runs. */
function counting() {
  const opened: { closed: boolean }[] = [];
  const open = (): Promise<HcControl> => {
    const state = { closed: false };
    opened.push(state);
    return Promise.resolve({
      coreId: "core",
      close: () => {
        state.closed = true;
      },
      machines: {
        list: () => Promise.resolve([]),
        add: () => Promise.reject(new Error("unused")),
        rm: () => Promise.resolve(),
        rename: () => Promise.reject(new Error("unused")),
        connect: () => Promise.reject(new Error("unused")),
      },
    });
  };
  return { opened, open };
}

describe("the host's core calls stop with the host", () => {
  test("a call after close opens no control connection, so a reconcile still running cannot start the core again", async () => {
    const { opened, open } = counting();
    const core = lazyMachines(target, open);
    await core.machines.list();
    await core.close();
    expect(opened).toEqual([{ closed: true }]);
    await expect(core.machines.rm("auto-c")).rejects.toThrow(HostStoppedError);
    await expect(core.machines.list()).rejects.toThrow(HostStoppedError);
    expect(opened).toHaveLength(1);
  });

  test("a connection still opening when the host stops is closed once it opens", async () => {
    const pending = Promise.withResolvers<HcControl>();
    let opens = 0;
    const core = lazyMachines(target, () => {
      opens += 1;
      return pending.promise;
    });
    const call = core.machines.list();
    const closing = core.close();
    const { opened, open } = counting();
    pending.resolve(await open());
    await closing;
    await call;
    expect(opens).toBe(1);
    expect(opened).toEqual([{ closed: true }]);
    await expect(core.machines.list()).rejects.toThrow(HostStoppedError);
    expect(opens).toBe(1);
  });
});
