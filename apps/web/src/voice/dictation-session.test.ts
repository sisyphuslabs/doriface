import { expect, test } from "bun:test";
import { Fake, rig } from "./dictation-rig.ts";

test("Done waits for the last words, then offers Korean and English as one transcript to edit", async () => {
  const { dictation, state, last } = rig({ engine: "service" });
  await dictation.start();
  last().emit("speechstart");
  last().say(["마이그레이션 롤백 스크립트부터", false]);
  expect(state()).toEqual({ kind: "listening", since: 1_000, heard: true, text: "마이그레이션 롤백 스크립트부터" });

  dictation.stop();
  expect(last().stopped).toBe(true);
  expect(state()).toEqual({ kind: "transcribing", since: 1_000 });
  last().say(["마이그레이션 롤백 스크립트부터 보여줘.", true], [" Then run the db tests again.", true]);
  last().emit("end");
  expect(state()).toEqual({
    kind: "ready",
    transcript: "마이그레이션 롤백 스크립트부터 보여줘. Then run the db tests again.",
  });
});

test("a session that ends with no words is no speech, and offers nothing", async () => {
  const { dictation, state, last } = rig({ engine: "service" });
  await dictation.start();
  dictation.stop();
  last().emit("end");
  expect(state()).toEqual({ kind: "error", reason: "no-speech" });
  expect(dictation.take()).toBeNull();
});

const FAILURES = [
  ["not-allowed", false, "permission"],
  ["service-not-allowed", false, "service"],
  ["service-not-allowed", true, "device"],
  ["no-speech", false, "no-speech"],
  ["audio-capture", false, "microphone"],
  ["network", false, "network"],
  ["language-not-supported", false, "language"],
  ["language-not-supported", true, "device"],
  ["phrases-not-supported", false, "service"],
] as const;

for (const [code, local, reason] of FAILURES) {
  test(`a recognizer error ${code}${local ? " on the device" : ""} reads as ${reason}`, async () => {
    const { dictation, state, last } = rig(local ? { engine: "device", local: "available" } : { engine: "service" });
    await dictation.start();
    last().say(["half a sentence", false]);
    last().emit("error", { error: code });
    last().emit("end");
    expect(state()).toEqual({ kind: "error", reason });
  });
}

test("Cancel aborts the recognizer and drops what it heard, even words that arrive after", async () => {
  const { dictation, state, last } = rig({ engine: "service" });
  await dictation.start();
  last().say(["rm -rf build", true]);
  dictation.cancel();
  expect(last().aborted).toBe(true);
  expect(state()).toEqual({ kind: "idle" });
  last().say(["rm -rf build", true]);
  last().emit("end");
  expect(state()).toEqual({ kind: "idle" });
  expect(dictation.take()).toBeNull();
});

test("the edited transcript is what gets typed, on one line with no Enter", async () => {
  const { dictation, state, last } = rig({ engine: "service" });
  await dictation.start();
  last().say(["echo voice", true]);
  dictation.stop();
  last().emit("end");
  dictation.edit("echo voice-$((40+2))\n");
  expect(state()).toEqual({ kind: "ready", transcript: "echo voice-$((40+2))\n" });
  expect(dictation.take()).toBe("echo voice-$((40+2))");
  expect(state()).toEqual({ kind: "idle" });
});

test("a recognizer that refuses to start reads as the service being off", async () => {
  const { dictation, state, made } = rig({ engine: "service" });
  const original = Fake.prototype.start;
  Fake.prototype.start = () => {
    throw new DOMException("already started", "InvalidStateError");
  };
  try {
    await dictation.start();
  } finally {
    Fake.prototype.start = original;
  }
  expect(made).toHaveLength(1);
  expect(state()).toEqual({ kind: "error", reason: "service" });
});

test("the recognizer's own end of speech ends listening, and the transcript still waits to be edited (#194 Q5)", async () => {
  const { dictation, state, last } = rig({ engine: "service" });
  await dictation.start();
  expect(last().continuous).toBe(false);
  last().emit("speechstart");
  last().say(["git status", false]);
  last().emit("speechend");
  expect(state()).toEqual({ kind: "transcribing", since: 1_000 });
  expect(last().stopped).toBe(false);
  last().say(["git status", true]);
  last().emit("end");
  expect(state()).toEqual({ kind: "ready", transcript: "git status" });
  dictation.edit("git status --short");
  expect(dictation.take()).toBe("git status --short");
});
