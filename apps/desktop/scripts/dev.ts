import { join } from "node:path";
import { loopbackDevUrl } from "../src/config/origin.ts";

/** Runs the shell against the Vite dev server (default http://localhost:5173). */
const url = loopbackDevUrl(Bun.argv[2] ?? "http://localhost:5173");
const electron = Bun.spawn([process.execPath, "x", "electron", "."], {
  cwd: join(import.meta.dir, ".."),
  env: { ...process.env, DORIFACE_DESKTOP_DEV_URL: url },
  stdout: "inherit",
  stderr: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => electron.kill(signal));
process.exit(await electron.exited);
