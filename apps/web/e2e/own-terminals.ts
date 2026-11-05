import { test } from "./fixtures.ts";
import { hcOn } from "./machine-switch.ts";

/** The live terminals on the e2e core, this machine's and the added machine's, as hc lists them. */
function liveTerminals(): string[] {
  const listed: unknown = JSON.parse(hcOn("host", ["ls", "--json"]));
  const terminals = typeof listed === "object" && listed !== null ? Reflect.get(listed, "terminals") : undefined;
  if (!Array.isArray(terminals)) throw new Error("hc ls printed no terminal list");
  return terminals.flatMap((terminal: unknown) => {
    const address = typeof terminal === "object" && terminal !== null ? Reflect.get(terminal, "address") : undefined;
    return typeof address === "string" ? [address] : [];
  });
}

/**
 * Every test in the calling file ends the terminals it opened, and only those: the ones live after it that were not
 * live before it, whether a spec started them or the page did (New tab, a split). A later spec counting the core's
 * terminals then sees only its own.
 */
export function endOwnTerminals(): void {
  let before = new Set<string>();
  test.beforeEach(() => {
    before = new Set(liveTerminals());
  });
  test.afterEach(() => {
    const opened = liveTerminals().filter((address) => !before.has(address));
    for (const address of opened) {
      try {
        hcOn("host", ["kill", address]);
      } catch (error) {
        if (liveTerminals().includes(address)) throw error;
      }
    }
  });
}
