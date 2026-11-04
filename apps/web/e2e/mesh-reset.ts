// Puts the mesh panel's documents back to the e2e host's start state, with the fixture's times taken now. The host
// seeds them once when it starts, and the seeded join's offer ends 8 minutes later, while a spec runs whenever the
// single-worker suite reaches it (#127); an answer a spec wrote would also stay for every later spec.
import { MESH_APPROVAL_DOC, MESH_STATUS_DOC } from "@doriface/protocol";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { setCoreDoc } from "./core-doc.ts";

export function resetMeshDocs(): void {
  const printed = execFileSync("bun", [join(import.meta.dirname, "mesh-doc.ts")], { encoding: "utf8" });
  const value: unknown = JSON.parse(printed);
  setCoreDoc(MESH_STATUS_DOC, value);
  setCoreDoc(MESH_APPROVAL_DOC, {});
}
