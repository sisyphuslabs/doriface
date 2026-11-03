// Runs as the host's `hc`: forwards to the real one, and for `connect` appends every byte to `<pid>.in` (what hc
// read) and `<pid>.out` (what hc wrote) before passing it on, so whatever reached the client is already on disk.
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const real = process.env["DORIFACE_REAL_HC"] ?? "";
const dir = process.env["DORIFACE_TAP_DIR"] ?? "";
if (real === "" || dir === "") throw new Error("hc-tap needs DORIFACE_REAL_HC and DORIFACE_TAP_DIR");
const args = process.argv.slice(2);

if (args[0] !== "connect") {
  const passthrough = Bun.spawn([real, ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  process.exit(await passthrough.exited);
}

const base = join(dir, String(process.pid));
const hc = Bun.spawn([real, ...args], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
void (async () => {
  for await (const chunk of Bun.stdin.stream()) {
    appendFileSync(`${base}.in`, chunk);
    hc.stdin.write(chunk);
    await hc.stdin.flush();
  }
  await hc.stdin.end();
})();
const stdout = Bun.stdout.writer();
for await (const chunk of hc.stdout) {
  appendFileSync(`${base}.out`, chunk);
  stdout.write(chunk);
  await stdout.flush();
}
process.exit(await hc.exited);
