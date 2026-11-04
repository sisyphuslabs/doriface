/**
 * A mesh of two hosts in a plain process, for the harness test that ends it with a signal: it prints every process it
 * owns as one JSON line and then waits. The interrupt hook (process-group.ts) must leave none of them behind.
 */
import { startMesh } from "./mesh.ts";

const mesh = await startMesh({ names: ["a", "b"] });
console.log(JSON.stringify((await mesh.owned()).map((own) => own.pid)));
await new Promise<never>(() => undefined);
