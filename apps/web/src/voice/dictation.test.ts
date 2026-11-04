import { expect, test } from "bun:test";
import { reach, rig } from "./dictation-rig.ts";

test("with no recognizer the mic says why instead of listening", async () => {
  const { dictation, made, state } = rig({ support: { kind: "unavailable", why: "unsupported" } });
  await dictation.start();
  expect(state()).toEqual({ kind: "unavailable", why: "unsupported" });
  expect(made).toHaveLength(0);
});

test("the browser's speech service hears nothing until the user allows it, and the yes is remembered", async () => {
  const { dictation, made, remembered, state, last } = rig({ engine: "ask" });
  await dictation.start();
  expect(state()).toEqual({ kind: "consent", device: false });
  expect(made).toHaveLength(0);

  await dictation.allowService();
  expect(remembered).toEqual(["service"]);
  expect(state()).toEqual({ kind: "listening", since: 1_000, heard: false, text: "" });
  expect(last()).toMatchObject({ lang: "ko-KR", continuous: true, interimResults: true, processLocally: false });
  expect(last().started).toBe(true);
});

test("Not now starts nothing", async () => {
  const { dictation, made, remembered, state } = rig({ engine: "ask" });
  await dictation.start();
  dictation.close();
  expect(state()).toEqual({ kind: "idle" });
  expect(made).toHaveLength(0);
  expect(remembered).toEqual([]);
});

test("an installed on-device language pack listens locally without asking", async () => {
  const { dictation, state, last } = rig({ engine: "ask", local: "available" });
  await dictation.start();
  expect(state().kind).toBe("listening");
  expect(last().processLocally).toBe(true);
});

test("keeping it on this device installs the language pack, then listens locally", async () => {
  const install = Promise.withResolvers<boolean>();
  const { dictation, remembered, installs, made, state, last } = rig({
    engine: "ask",
    local: "downloadable",
    install: () => install.promise,
  });
  await dictation.start();
  expect(state()).toEqual({ kind: "consent", device: true });

  const preparing = reach(dictation, "preparing");
  const kept = dictation.keepOnDevice();
  await preparing;
  expect(remembered).toEqual(["device"]);
  expect(installs).toHaveLength(1);
  expect(state()).toEqual({ kind: "preparing" });
  expect(made).toHaveLength(0);

  install.resolve(true);
  await kept;
  expect(state().kind).toBe("listening");
  expect(last().processLocally).toBe(true);
});

test("a failed on-device install says so and starts no recognizer", async () => {
  const { dictation, made, state } = rig({ engine: "device", local: "downloadable", install: async () => false });
  await dictation.start();
  expect(state()).toEqual({ kind: "error", reason: "device" });
  expect(made).toHaveLength(0);
});

test("on-device only, where the browser cannot recognize on the device, never falls back to the service", async () => {
  const { dictation, made, state } = rig({ engine: "device" });
  await dictation.start();
  expect(state()).toEqual({ kind: "error", reason: "device" });
  expect(made).toHaveLength(0);
});

test("Cancel while the language pack installs starts no recognizer when the install finishes", async () => {
  const install = Promise.withResolvers<boolean>();
  const { dictation, made, state } = rig({ engine: "device", local: "downloadable", install: () => install.promise });
  const preparing = reach(dictation, "preparing");
  const started = dictation.start();
  await preparing;
  expect(state()).toEqual({ kind: "preparing" });
  dictation.cancel();
  install.resolve(true);
  await started;
  expect(state()).toEqual({ kind: "idle" });
  expect(made).toHaveLength(0);
});
