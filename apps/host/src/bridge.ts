import type { Link } from "./link.ts";

/**
 * Joins two links. Bytes flow both ways untouched; each direction hands a chunk on only after the other side
 * took the previous one, and the first close on either side closes both. Resolves once both are closed.
 */
export function bridge(a: Link, b: Link, onError: (error: unknown) => void = () => {}): Promise<void> {
  const done = Promise.withResolvers<void>();
  let open = true;
  const closeBoth = (): void => {
    if (!open) return;
    open = false;
    a.close();
    b.close();
    done.resolve();
  };
  const forwardTo =
    (target: Link) =>
    async (bytes: Uint8Array): Promise<void> => {
      if (!open) return;
      try {
        await target.send(bytes);
      } catch (error) {
        onError(error);
        closeBoth();
      }
    };
  a.onClose(closeBoth);
  b.onClose(closeBoth);
  a.onData(forwardTo(b));
  b.onData(forwardTo(a));
  return done.promise;
}
