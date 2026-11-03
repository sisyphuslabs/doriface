/** Runs the shell against the Vite dev server (default http://localhost:5173). */
const url = Bun.argv[2] ?? "http://localhost:5173";
const electron = Bun.spawn(["bun", "x", "electron", "."], {
  cwd: import.meta.dir + "/..",
  env: { ...process.env, DORIFACE_DESKTOP_DEV_URL: url },
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await electron.exited);
