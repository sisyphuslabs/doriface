import type { Page } from "@playwright/test";

/** How the page set up one recognition session, read when it called start(). */
export interface StartedSession {
  readonly lang: string;
  readonly continuous: boolean;
  readonly interimResults: boolean;
  readonly processLocally: boolean;
}

/** The page's speech recognizer, replaced by one the spec drives: what it was asked to do, and what it "heard". */
export interface SpeechStub {
  readonly started: () => Promise<readonly StartedSession[]>;
  readonly stops: () => Promise<number>;
  readonly aborts: () => Promise<number>;
  /** One result event holding every segment so far, each final or not, after a speechstart. */
  readonly say: (...segments: readonly (readonly [string, boolean])[]) => Promise<void>;
  /** An error event with this code, then the end of the session, as a browser reports a failure. */
  readonly fail: (code: string) => Promise<void>;
  /** The end of the session, which a browser fires after stop() once its last result is in. */
  readonly end: () => Promise<void>;
}

/** Call before page.goto: SpeechRecognition and webkitSpeechRecognition become the stub. No audio is captured. */
export async function stubSpeech(page: Page): Promise<SpeechStub> {
  await page.addInitScript(() => {
    const started: StartedSession[] = [];
    const calls = { started, stops: 0, aborts: 0 };
    let current: EventTarget | null = null;
    const fire = (type: string, fields: Record<string, unknown> = {}): void => {
      current?.dispatchEvent(Object.assign(new Event(type), fields));
    };
    class StubRecognition extends EventTarget {
      lang = "";
      continuous = false;
      interimResults = false;
      processLocally = false;
      start(): void {
        const { lang, continuous, interimResults, processLocally } = this;
        calls.started.push({ lang, continuous, interimResults, processLocally });
        current = this;
        queueMicrotask(() => {
          fire("start");
          fire("audiostart");
        });
      }
      stop(): void {
        calls.stops += 1;
      }
      abort(): void {
        calls.aborts += 1;
        fire("error", { error: "aborted" });
        fire("end");
      }
    }
    for (const name of ["SpeechRecognition", "webkitSpeechRecognition"]) {
      Object.defineProperty(window, name, { value: StubRecognition, configurable: true, writable: true });
    }
    Reflect.set(window, "__speech", {
      calls,
      say: (segments: readonly (readonly [string, boolean])[]) => {
        fire("speechstart");
        const results = segments.map(([transcript, isFinal]) =>
          Object.assign([{ transcript, confidence: 0.9 }], { isFinal }),
        );
        fire("result", { resultIndex: 0, results });
      },
      fail: (code: string) => {
        fire("error", { error: code });
        fire("end");
      },
      end: () => fire("end"),
    });
  });
  const calls = () =>
    page.evaluate(() => {
      const { started, stops, aborts } = Reflect.get(Reflect.get(window, "__speech"), "calls");
      const sessions: StartedSession[] = [...started];
      return { started: sessions, stops: Number(stops), aborts: Number(aborts) };
    });
  return {
    started: async () => (await calls()).started,
    stops: async () => (await calls()).stops,
    aborts: async () => (await calls()).aborts,
    say: (...segments) => page.evaluate((list) => Reflect.get(window, "__speech").say(list), segments),
    fail: (code) => page.evaluate((error) => Reflect.get(window, "__speech").fail(error), code),
    end: () => page.evaluate(() => Reflect.get(window, "__speech").end()),
  };
}

/** Call before page.goto: the page has no speech recognizer at all, as in Firefox and some Electron builds. */
export async function removeSpeech(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const name of ["SpeechRecognition", "webkitSpeechRecognition"]) {
      Object.defineProperty(window, name, { value: undefined, configurable: true, writable: true });
    }
  });
}
