export interface Deadline {
  readonly timeoutMs?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * Settles with `promise` unless the timeout or the abort signal comes first; then `onExpire`
 * runs once and the result rejects with the timeout error or the signal's reason.
 */
export function raceDeadline<T>(
  promise: Promise<T>,
  deadline: Deadline,
  timeoutError: () => Error,
  onExpire: () => void = () => {},
): Promise<T> {
  const { timeoutMs, signal } = deadline;
  if (timeoutMs === undefined && signal === undefined) return promise;
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
      onExpire();
      reject(reason);
    };
    const onAbort = () => expire(signal?.reason);
    if (signal?.aborted === true) {
      expire(signal.reason);
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    if (timeoutMs !== undefined) timer = setTimeout(() => expire(timeoutError()), timeoutMs);
    void settleFrom(
      promise,
      (value) => {
        if (finish()) resolve(value);
      },
      (error) => {
        if (finish()) reject(error);
      },
    );
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
