/** The page events that mean "this page can work again", as the store needs them. */
export interface WakeSources {
  /** Registers a listener for `online` and `pageshow`. */
  readonly on: (type: "online" | "pageshow", listener: () => void) => void;
  /** How the page reports becoming visible, or undefined where there is no document. */
  readonly visibility: { readonly state: () => string; readonly listen: (listener: () => void) => void } | undefined;
}

/** The running page's own events: no document under a test runner or a worker, so visibility is simply absent there. */
export function pageWakeSources(): WakeSources {
  return {
    on: (type, listener) => {
      if (typeof addEventListener === "function") addEventListener(type, listener);
    },
    visibility:
      typeof document === "undefined"
        ? undefined
        : {
            state: () => document.visibilityState,
            listen: (listener) => document.addEventListener("visibilitychange", listener),
          },
  };
}

/**
 * Runs a waiting reconnect the moment the page can work again: the network came back, a page came out of the back/forward
 * cache, or a tab became visible. A phone returning from the background fires `visibilitychange` and `pageshow`, not
 * `online`, so listening for the network alone left it waiting out a back-off and a heartbeat before it noticed (#653).
 */
export function resumeOnWake(store: { retryNow(): void }, sources: WakeSources = pageWakeSources()): void {
  const wake = (): void => store.retryNow();
  sources.on("online", wake);
  sources.on("pageshow", wake);
  sources.visibility?.listen(() => {
    if (sources.visibility?.state() === "visible") wake();
  });
}
