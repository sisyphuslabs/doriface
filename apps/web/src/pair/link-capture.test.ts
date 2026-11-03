import { afterEach, describe, expect, test } from "bun:test";
import { capturePairingLink, pairingLink, type UrlScope } from "./link-capture.ts";

const SECRET = "A".repeat(43);
const FRAGMENT = `#h=${"a".repeat(26)}&k=${"k".repeat(43)}&s=${"s".repeat(43)}&p=${SECRET}&r=wss://relay.invalid`;

/** A window whose session history is a list of URLs; replaceState rewrites the last entry like a browser does. */
function browser(href: string): UrlScope & { readonly entries: string[]; readonly states: unknown[] } {
  const entries = [href];
  const states: unknown[] = [{ key: "first" }];
  return {
    entries,
    states,
    location: {
      get href() {
        return entries.at(-1) ?? "";
      },
    },
    history: {
      get state() {
        return states.at(-1);
      },
      replaceState(state: unknown, _unused: string, url?: string | URL | null) {
        entries[entries.length - 1] = new URL(url ?? "", entries.at(-1)).href;
        states[states.length - 1] = state;
      },
    },
  };
}

afterEach(() => pairingLink.set(null));

describe("capturePairingLink", () => {
  test("moves the link out of the address bar and history into memory, keeping the history state", () => {
    const window = browser(`https://doriface.omo.dev/pair${FRAGMENT}`);
    capturePairingLink(window);
    expect(window.location.href).toBe("https://doriface.omo.dev/pair");
    expect(window.entries.filter((entry) => entry.includes(SECRET))).toEqual([]);
    expect(window.states).toEqual([{ key: "first" }]);
    expect(pairingLink.get()).toBe(FRAGMENT);
  });

  test("scrubs a secret put in the query as well, and takes only the fragment", () => {
    const window = browser(`app://doriface/pair?p=${SECRET}${FRAGMENT}`);
    capturePairingLink(window);
    expect(window.location.href).toBe("app://doriface/pair");
    expect(pairingLink.get()).toBe(FRAGMENT);

    const queryOnly = browser(`https://doriface.omo.dev/pair?p=${SECRET}`);
    capturePairingLink(queryOnly);
    expect(queryOnly.location.href).toBe("https://doriface.omo.dev/pair");
  });

  test("takes /pair/ with a trailing slash, which the router shows as the pair page, the same way", () => {
    for (const path of ["/pair/", "/pair//"]) {
      const window = browser(`https://doriface.omo.dev${path}${FRAGMENT}`);
      capturePairingLink(window);
      expect(window.location.href).toBe("https://doriface.omo.dev/pair");
      expect(window.entries.filter((entry) => entry.includes(SECRET))).toEqual([]);
      expect(pairingLink.get()).toBe(FRAGMENT);
      pairingLink.set(null);
    }
  });

  test("leaves other routes and a bare /pair alone", () => {
    for (const href of [
      `https://doriface.omo.dev/settings${FRAGMENT}`,
      `https://doriface.omo.dev/pairx${FRAGMENT}`,
      "https://doriface.omo.dev/pair",
      "https://doriface.omo.dev/pair/",
    ]) {
      const window = browser(href);
      capturePairingLink(window);
      expect(window.location.href).toBe(href);
    }
    expect(pairingLink.get()).toBeNull();
  });

  test("tells subscribers about a new link", () => {
    const seen: (string | null)[] = [];
    const unsubscribe = pairingLink.subscribe(() => seen.push(pairingLink.get()));
    capturePairingLink(browser(`https://doriface.omo.dev/pair${FRAGMENT}`));
    unsubscribe();
    pairingLink.set(null);
    expect(seen).toEqual([FRAGMENT]);
  });
});
