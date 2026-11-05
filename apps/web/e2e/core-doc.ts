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

/** A herdr document on the e2e host's core, as another client would read it. */
export function getCoreDoc(name: string): unknown {
  const current = call(coreEnv(), "doc.get", { name });
  return typeof current === "object" && current !== null && "value" in current ? current.value : null;
}
