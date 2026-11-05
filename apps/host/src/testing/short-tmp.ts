import { tmpdir } from "node:os";

/** The longest Unix socket path every platform the suite runs on accepts: macOS allows 103 bytes, Linux 107. */
export const SOCKET_PATH_MAX = 103;

/**
 * How deep the suite nests a socket under its base dir: the run's dir, a scratch dir per session and the socket hc
 * derives from `$XDG_RUNTIME_DIR` take 52 bytes (#509); the rest is headroom for longer names.
 */
export const SOCKET_DEPTH = 63;

/**
 * The dir a run keeps its scratch files under: `$TMPDIR` when a socket nested in it stays within the limit, else
 * `/tmp` (#509; a deep per-task `$TMPDIR`, or macOS's own under /var/folders). Windows has no such limit to keep under.
 */
export function socketSafeBase(base = tmpdir()): string {
  if (process.platform === "win32") return base;
  return Buffer.byteLength(base) <= SOCKET_PATH_MAX - SOCKET_DEPTH ? base : "/tmp";
}
