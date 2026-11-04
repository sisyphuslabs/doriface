import { type ByteLink, HcConnection } from "@doriface/client";
import { HcRpcError, HOST_INFO_DOC, type HostInfo, hostInfoFor, parseHostInfo } from "@doriface/protocol";
import { type HcTarget, spawnHcLink } from "./mesh/hc-machines.ts";

export interface HostInfoPublisher {
  /** Settles once the document is written (or left as it was, or the write failed and was logged) and its child exited. */
  readonly settled: Promise<void>;
  /** Ends the write if it is still going; settles once its `hc connect` child has exited. */
  stop(): Promise<void>;
}

const isConflict = (error: unknown): boolean => error instanceof HcRpcError && error.kind === "conflict";

/**
 * Writes this host's `doriface-host` document on its own core over one `hc connect` child of its own, so a client
 * reads the host's OS from the core (for this machine, or `on` a machine the core added) instead of guessing it. hc's
 * frames pass through untouched. A host on an OS the document does not name writes nothing, so clients keep guessing.
 */
export function publishHostInfo(
  core: HcTarget,
  platform: string,
  log: (line: string) => void,
  link: (core: HcTarget) => ByteLink = spawnHcLink,
): HostInfoPublisher {
  const info = hostInfoFor(platform);
  if (info === undefined) return { settled: Promise.resolve(), stop: () => Promise.resolve() };
  let stopped = false;
  const child = link(core);
  const exited = new Promise<void>((resolve) => child.onClose(() => resolve()));
  const write = async (): Promise<void> => {
    const connection = await HcConnection.open(child);
    try {
      await writeOnce(connection, info).catch((error: unknown) =>
        isConflict(error) ? writeOnce(connection, info) : Promise.reject(error),
      );
    } finally {
      connection.close();
    }
  };
  const settled = write()
    .catch((error: unknown) => {
      if (!stopped) log(`host: cannot write this host's OS on its core: ${String(error)}`);
    })
    .finally(() => child.close())
    .then(() => exited);
  return {
    settled,
    stop() {
      stopped = true;
      child.close();
      return exited;
    },
  };
}

async function writeOnce(connection: HcConnection, info: HostInfo): Promise<"written" | "unchanged"> {
  const current = await connection.call("doc.get", { name: HOST_INFO_DOC });
  if (parseHostInfo(current.value)?.os === info.os) return "unchanged";
  await connection.call("doc.set", { name: HOST_INFO_DOC, value: { ...info }, version: current.version });
  return "written";
}
