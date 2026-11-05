// A spec's write to a herdr document on the e2e host's own core, the way another client would make it: read the
// version, then a compare-and-set at it, with the core environment the e2e host saved (E2E_HOST_ENV).
import { execFileSync } from "node:child_process";
import { E2E_HOST_ENV, E2E_LAYOUT_ENV } from "./config.ts";
import { readSavedEnv, type SavedEnv } from "./saved-env.ts";

interface CoreEnv extends SavedEnv {
  readonly session: string;
}

/** Which e2e core: the main host's, or the layout spec's (E2E_LAYOUT_ENV). */
export type Core = "host" | "layout";

function coreEnv(core: Core = "host"): CoreEnv {
  const file = core === "host" ? E2E_HOST_ENV : E2E_LAYOUT_ENV;
  const saved = readSavedEnv(file);
  const session = saved.env["HC_SESSION"];
  if (session === undefined) throw new Error(`${file} names no HC_SESSION`);
  return { ...saved, session };
}

function call(core: CoreEnv, method: string, params: unknown): unknown {
  const request = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })}\n`;
  const reply = execFileSync(core.hc, ["connect", "--session", core.session], {
    env: { ...process.env, ...core.env },
    input: request,
  }).toString();
  for (const line of reply.split("\n")) {
    const message: unknown = line.trim() === "" ? undefined : JSON.parse(line);
    if (typeof message === "object" && message !== null && "id" in message && message.id === 1) {
      if ("result" in message) return message.result;
      throw new Error(`${method} failed: ${line.slice(0, 300)}`);
    }
  }
  throw new Error(`${method}: no reply`);
}

/** An added machine's permanent core id, as the e2e host's core lists it (`machine.list`): the id a machine order names. */
export function machineCore(name: string): string {
  const listed = call(coreEnv(), "machine.list", {});
  const machines = typeof listed === "object" && listed !== null && "machines" in listed ? listed.machines : undefined;
  const found = Array.isArray(machines)
    ? machines.find(
        (machine: unknown) =>
          typeof machine === "object" && machine !== null && "name" in machine && machine.name === name,
      )
    : undefined;
  if (typeof found !== "object" || found === null || !("id" in found) || typeof found.id !== "string") {
    throw new Error(`machine.list names no machine ${name}`);
  }
  return found.id;
}

/** A document on the e2e host's own core as `doc.get` returns it. */
export function coreDoc(name: string): unknown {
  return call(coreEnv(), "doc.get", { name });
}

export function setCoreDoc(name: string, value: unknown, on?: string, which: Core = "host"): void {
  const core = coreEnv(which);
  const where = on === undefined ? { name } : { name, on };
  const current = call(core, "doc.get", where);
  const version = typeof current === "object" && current !== null && "version" in current ? current.version : 0;
  call(core, "doc.set", { ...where, value, version });
}

/** A herdr document on the e2e host's core (or, with `on`, on its added machine), as another client would read it. */
export function getCoreDoc(name: string, on?: string): unknown {
  const current = call(coreEnv(), "doc.get", on === undefined ? { name } : { name, on });
  return typeof current === "object" && current !== null && "value" in current ? current.value : null;
}
