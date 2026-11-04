import { Dictation, type DictationState } from "./dictation.ts";
import type { RecognizerClass, Support } from "./recognizer.ts";
import type { Engine } from "./voice-settings.ts";

type Availability = "available" | "downloadable" | "downloading" | "unavailable";

/** A browser recognizer the test drives: it records how it was set up and fires the events a real one would. */
export class Fake extends EventTarget {
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
    const results = segments.map(([transcript, isFinal]) =>
      Object.assign([{ transcript, confidence: 0.9 }], { isFinal }),
    );
    this.emit("result", { resultIndex: 0, results });
  }
}

export interface Rig {
  readonly dictation: Dictation;
  readonly made: Fake[];
  readonly remembered: Engine[];
  readonly installs: number[];
  readonly state: () => DictationState;
  readonly last: () => Fake;
}

export function rig(options: {
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
  const { local } = options;
  const statics =
    local === undefined
      ? {}
      : {
          available: async () => local,
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
export const reach = (dictation: Dictation, kind: DictationState["kind"]): Promise<void> =>
  new Promise((resolve) => {
    const stop = dictation.subscribe(() => {
      if (dictation.state.kind !== kind) return;
      stop();
      resolve();
    });
  });
