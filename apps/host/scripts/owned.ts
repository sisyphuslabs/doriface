/** What `withOwned` listens on: `process` in the bench, an EventEmitter in a test. */
export interface Signals {
  once(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

/** The shell's exit code for a process ended by each signal: 128 + its number. */
export const SIGNAL_EXIT = { SIGINT: 130, SIGTERM: 143 } as const;

export interface OwnedOptions {
  readonly signals?: Signals;
  readonly exit?: (code: number) => void;
}

/**
 * Runs `body`, then `stop` exactly once, however it ends: when it returns, when it throws (the error is rethrown once
 * stopped), or on SIGINT or SIGTERM, after which it exits 130 or 143 once stopped (1 if stopping failed).
 */
export async function withOwned<T>(
  stop: () => Promise<void>,
  body: () => Promise<T>,
  { signals = process, exit = (code) => process.exit(code) }: OwnedOptions = {},
): Promise<T> {
  let stopping: Promise<void> | undefined;
  const stopOnce = (): Promise<void> => (stopping ??= stop());
  const listeners = (["SIGINT", "SIGTERM"] as const).map((signal) => {
    const listener = (): void => {
      stopOnce().then(
        () => exit(SIGNAL_EXIT[signal]),
        (error: unknown) => {
          process.stderr.write(
            `${signal}: could not stop: ${error instanceof Error ? error.message : String(error)}\n`,
          );
          exit(1);
        },
      );
    };
    signals.once(signal, listener);
    return [signal, listener] as const;
  });
  try {
    return await body();
  } finally {
    for (const [signal, listener] of listeners) signals.off(signal, listener);
    await stopOnce();
  }
}
