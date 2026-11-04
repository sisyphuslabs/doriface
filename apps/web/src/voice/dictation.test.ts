import { expect, test } from "bun:test";
import { Dictation, type DictationState } from "./dictation.ts";
import type { RecognizerClass, Support } from "./recognizer.ts";
import type { Engine } from "./voice-settings.ts";

type Availability = "available" | "downloadable" | "downloading" | "unavailable";

/** A browser recognizer the test drives: it records how it was set up and fires the events a real one would. */
class Fake extends EventTarget {
  lang = "";
  continuous = false;
  interimResults = false;
  processLocally = false;
  started = false;
  stopped = false;
  aborted = false;
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
  abort(): void {
    this.aborted = true;
    this.emit("error", { error: "aborted" });
    this.emit("end");
  }
  emit(type: string, fields: Record<string, unknown> = {}): void {
    this.dispatchEvent(Object.assign(new Event(type), fields));
  }
  /** One result event holding every segment so far, each final or not, as a continuous session reports them. */
  say(...segments: readonly (readonly [string, boolean])[]): void {
    const results = segments.map(([transcript, isFinal]) => Object.assign([{ transcript, confidence: 0.9 }], { isFinal }));
    this.emit("result", { resultIndex: 0, results });
  }
}

interface Rig {
  readonly dictation: Dictation;
  readonly made: Fake[];
  readonly remembered: Engine[];
  readonly installs: number[];
  readonly state: () => DictationState;
  readonly last: () => Fake;
}

function rig(options: {
  readonly engine?: Engine;
  readonly local?: Availability;
  readonly install?: () => Promise<boolean>;
  readonly support?: Support;
}): Rig {
  const made: Fake[] = [];
  const remembered: Engine[] = [];
  const installs: number[] = [];
  let engine = options.engine ?? "ask";
  class Recognizer extends Fake {
    constructor() {
      super();
      made.push(this);
    }
  }
  const statics =
    options.local === undefined
      ? {}
      : {
          available: async () => options.local,
          install: async () => {
            installs.push(1);
            return (await options.install?.()) ?? true;
          },
        };
  const recognizer: RecognizerClass = Object.assign(Recognizer, statics);
  const dictation = new Dictation({
    support: options.support ?? { kind: "ok", recognizer },
    language: () => "ko-KR",
    engine: () => engine,
    remember: (next) => {
      engine = next;
      remembered.push(next);
    },
    now: () => 1_000,
  });
  return {
    dictation,
    made,
    remembered,
    installs,
    state: () => dictation.state,
    last: () => {
      const fake = made.at(-1);
      if (fake === undefined) throw new Error("no recognizer was made");
      return fake;
    },
  };
}

/** Resolves once the dictation reaches `kind`, subscribed before the step that gets it there runs on. */
const reach = (dictation: Dictation, kind: DictationState["kind"]): Promise<void> =>
  new Promise((resolve) => {
    const stop = dictation.subscribe(() => {
      if (dictation.state.kind !== kind) return;
      stop();
      resolve();
    });
  });

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
  let finish: (ok: boolean) => void = () => undefined;
  const pending = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  const { dictation, remembered, installs, made, state, last } = rig({
    engine: "ask",
    local: "downloadable",
    install: () => pending,
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

  finish(true);
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

test("Cancel while the language pack installs starts no recognizer when the install finishes", async () => {
  let finish: (ok: boolean) => void = () => undefined;
  const pending = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  const { dictation, made, state } = rig({ engine: "device", local: "downloadable", install: () => pending });
  const preparing = reach(dictation, "preparing");
  const started = dictation.start();
  await preparing;
  expect(state()).toEqual({ kind: "preparing" });
  dictation.cancel();
  finish(true);
  await started;
  expect(state()).toEqual({ kind: "idle" });
  expect(made).toHaveLength(0);
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
