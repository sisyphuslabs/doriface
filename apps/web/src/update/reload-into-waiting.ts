/**
 * How long a waiting worker that was asked to take over may stay "installed" before the page reloads anyway. Asked
 * normally, it leaves "installed" within 0.6 s (30 of 30 runs at load ~74, p50 0.21 s); 5 s leaves room for a loaded
 * machine and stays inside what a user waits for a reload.
 */
export const SWAP_MS = 5_000;
/**
 * How long a reload may take before the page reloads again. A reload sent while Chromium finishes the swap can
 * stall without ever loading (seen in 9 of 20 forced runs); a second one replaces it (8 of 8 forced runs, 3 s apart).
 */
export const RETRY_MS = 3_000;
/** How many page loads one Reload to update may take before it leaves the update waiting (and its dot lit) instead. */
export const MAX_LOADS = 3;
const LOADS_KEY = "doriface.update-loads";

interface Waiting {
  readonly state: string;
  postMessage(message: unknown): void;
}

export interface Workers {
  readonly controller: unknown;
  getRegistration(): Promise<{ readonly waiting: Waiting | null; readonly active: unknown } | undefined>;
  addEventListener(type: "controllerchange", listener: () => void, options: { once: true }): void;
}

export interface UpdateDeps {
  readonly workers: Workers;
  readonly reload: () => void;
  readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  readonly after: (ms: number, run: () => void) => void;
}

/**
 * Reload to update: asks the waiting worker to take over and reloads once the page changes controller. Chromium stops
 * the old worker to swap, and a request the page sends while it stops starts it again; the old worker then stays active
 * and the waiting one never takes over, so no controller change comes (#418). A reload from that state completes the
 * swap, so a worker still "installed" after SWAP_MS gets one. A reload sent while the swap completes can stall, so this
 * page reloads again every RETRY_MS for as long as it is still here; the next page carries on (resumeUpdate) until it is
 * controlled with no worker waiting, for at most MAX_LOADS loads.
 */
export async function reloadIntoWaitingWorker(deps: UpdateDeps): Promise<void> {
  if (deps.storage.getItem(LOADS_KEY) === null) deps.storage.setItem(LOADS_KEY, "0");
  const reloadNow = (): void => {
    deps.reload();
    deps.after(RETRY_MS, reloadNow);
  };
  let started = false;
  const start = (): void => {
    if (started) return;
    started = true;
    reloadNow();
  };
  deps.workers.addEventListener("controllerchange", start, { once: true });
  const waiting = (await deps.workers.getRegistration())?.waiting ?? null;
  if (waiting === null) {
    start();
    return;
  }
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a ServiceWorker.postMessage takes no origin
  waiting.postMessage({ type: "SKIP_WAITING" });
  deps.after(SWAP_MS, () => {
    if (waiting.state === "installed") start();
  });
}

/**
 * On load: a Reload to update in progress is done once this page is controlled with no worker waiting; otherwise (still
 * waiting, or loaded past a worker that is active) it carries on, for at most MAX_LOADS loads.
 */
export async function resumeUpdate(deps: UpdateDeps): Promise<void> {
  const loads = deps.storage.getItem(LOADS_KEY);
  if (loads === null) return;
  const found = await deps.workers.getRegistration();
  const landed = (found?.waiting ?? null) === null && (deps.workers.controller !== null || found?.active == null);
  if (landed || Number(loads) + 1 >= MAX_LOADS) {
    deps.storage.removeItem(LOADS_KEY);
    return;
  }
  deps.storage.setItem(LOADS_KEY, String(Number(loads) + 1));
  await reloadIntoWaitingWorker(deps);
}
