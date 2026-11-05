import type { HcConnection } from "@doriface/client";
import { type ApprovalCore, HcRpcError } from "@doriface/protocol";

/** The approval's hc calls over this client's connection; a version conflict on `doc.set` is an answer, not an error. */
const where = (on: string | undefined) => (on === undefined ? {} : { on });

export function approvalCore(connection: HcConnection): ApprovalCore {
  return {
    terminal: (address) => connection.call("terminal.get", { terminal: address }),
    screen: async (address) => (await connection.call("terminal.read", { terminal: address, lines: 0 })).text,
    keys: async (address, keys) => {
      await connection.call("terminal.keys", { terminal: address, keys });
    },
    doc: (name, on) => connection.call("doc.get", { name, ...where(on) }),
    setDoc: async (name, on, value, version) => {
      try {
        await connection.call("doc.set", { name, value, version, ...where(on) });
        return "ok";
      } catch (error) {
        if (error instanceof HcRpcError && error.kind === "conflict") return "conflict";
        throw error;
      }
    },
  };
}
