export interface Deadline {
  readonly timeoutMs?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

/** setTimeout fires at once for delays above this, so longer deadlines are capped to it. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Settles with `promise` unless the timeout or the abort signal comes first; then the result
 * rejects with the timeout error or the signal's reason, and `onExpire` runs once afterwards.
 * A non-finite `timeoutMs` means no timeout.
 */
export function raceDeadline<T>(
  promise: Promise<T>,
  deadline: Deadline,
  timeoutError: () => Error,
  onExpire: () => void = () => {},
): Promise<T> {
  const { timeoutMs, signal } = deadline;
  const timed = timeoutMs !== undefined && Number.isFinite(timeoutMs);
  if (!timed && signal === undefined) return promise;
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (): boolean => {
      if (settled) return false;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      return true;
    };
    const expire = (reason: unknown) => {
      if (!finish()) return;
      reject(reason);
      onExpire();
    };
    const onAbort = () => expire(signal?.reason);
    void settleFrom(
      promise,
      (value) => {
        if (finish()) resolve(value);
      },
      (error) => {
        if (finish()) reject(error);
      },
    );
    if (signal?.aborted === true) {
      expire(signal.reason);
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    if (timed) timer = setTimeout(() => expire(timeoutError()), Math.min(Math.max(timeoutMs, 0), MAX_TIMER_MS));
  });
}

async function settleFrom<T>(
  promise: Promise<T>,
  onValue: (value: T) => void,
  onError: (error: unknown) => void,
): Promise<void> {
  try {
    onValue(await promise);
  } catch (error) {
    onError(error);
  }
}
