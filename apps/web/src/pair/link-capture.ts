/**
 * A pairing link carries its single-use secret in the URL fragment (docs/transport.md, "Pairing"). The fragment never
 * reaches a server, but left in place it stays in the address bar and the session history, where a screenshot, a
 * synced tab or a restored session can carry it on. The app therefore moves it into memory before it renders or dials
 * anything, and the pair route reads it from here.
 */
export const PAIR_PATH = "/pair";

type Listener = () => void;

let current: string | null = null;
const listeners = new Set<Listener>();

/** The captured pairing fragment, leading "#" included, or null. */
export const pairingLink = {
  get: (): string | null => current,
  set(next: string | null): void {
    if (next === current) return;
    current = next;
    for (const listener of listeners) listener();
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export interface UrlScope {
  readonly location: { readonly href: string };
  readonly history: Pick<History, "state" | "replaceState">;
}

/**
 * On /pair, rewrites the current history entry to a bare /pair and keeps the fragment in memory. The spec puts the
 * link only in the fragment, so a query (which has already reached the server that served the page) is dropped
 * from the history entry too but never read. The router shows /pair/ as the pair page as well, so it is taken alike.
 */
export function capturePairingLink(scope: UrlScope = window): void {
  const url = new URL(scope.location.href);
  const path = url.pathname.replace(/\/+$/, "");
  if (path !== PAIR_PATH || (url.hash === "" && url.search === "")) return;
  scope.history.replaceState(scope.history.state, "", PAIR_PATH);
  if (url.hash.length > 1) pairingLink.set(url.hash);
}
