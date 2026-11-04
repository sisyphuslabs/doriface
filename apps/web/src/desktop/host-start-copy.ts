import type { HostStartFailure } from "./bridge.ts";

export interface HostStartCopy {
  readonly cause: string;
  readonly next: string;
  /** Set when installing herdr-core is the fix. */
  readonly install?: true;
}

export const HERDR_CORE_URL = "https://github.com/herdrdev/herdr-core";

const AGAIN = "If it keeps happening, Details shows what the host printed.";

/** The words for a failed start, from its code alone: the host's own output stays behind Details. */
export function hostStartCopy(failure: HostStartFailure): HostStartCopy {
  const { path, address } = failure;
  switch (failure.code) {
    case "hc-binary-missing":
      return path === undefined || !/[\\/]/.test(path)
        ? {
            cause: "herdr-core was not found on this computer.",
            next: "doriface looks for hc on your PATH and in ~/.local/bin, ~/.cargo/bin, /opt/homebrew/bin and /usr/local/bin. Install herdr-core there, or set HC_BIN to the full path of hc, then retry.",
            install: true,
          }
        : {
            cause: `herdr-core was not found at ${path}.`,
            next: "Install herdr-core there, or point HC_BIN at the hc you have, then retry.",
            install: true,
          };
    case "hc-version-failed":
      return {
        cause: `${path ?? "hc"} did not answer as herdr-core.`,
        next: "Install or update herdr-core, or point HC_BIN at the right hc, then retry.",
        install: true,
      };
    case "permission-denied":
      return path !== undefined
        ? {
            cause: `doriface may not run ${path}.`,
            next: "Make the file executable, or point HC_BIN at another hc, then retry.",
          }
        : { cause: `doriface may not listen on ${address ?? "its port"}.`, next: `Retry. ${AGAIN}` };
    case "port-in-use":
      return {
        cause: `${address ?? "The host's port"} is already in use.`,
        next: "Close the program using it, then retry.",
      };
    case "already-running":
      return {
        cause: "Another doriface host is already running on this computer.",
        next: "Quit it (another doriface window, or doriface-host in a terminal), then retry.",
      };
    case "host-timeout":
      return { cause: "The host took too long to start.", next: `Retry. ${AGAIN}` };
    default:
      return { cause: "The host stopped while it was starting.", next: `Retry. ${AGAIN}` };
  }
}
