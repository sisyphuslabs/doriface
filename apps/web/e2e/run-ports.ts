import { spawnSync } from "node:child_process";

/** How many consecutive ports the worker hosts get: slot n's host listens on E2E_HOST_PORT + n. */
export const HOST_BLOCK = 32;

const NAMES = ["E2E_HOST_PORT", "E2E_WEB_PORT", "E2E_LAYOUT_PORT"] as const;

// Binds port 0 for each, so the OS hands out ports no one holds, then releases them for this run's servers: a block of
// HOST_BLOCK consecutive free ports for the worker hosts, then one for the web server and one for the layout host
// (taken while the block is still held, so they never fall inside it). Prints them as JSON.
const PICK = `
const net = require("node:net");
const block = Number(process.env.E2E_HOST_BLOCK);
const listen = (port) => new Promise((resolve) => {
  const server = net.createServer();
  server.once("error", () => resolve(undefined));
  server.listen(port, "127.0.0.1", () => resolve(server));
});
(async () => {
  let held = [];
  for (let tries = 0; tries < 100 && held.length === 0; tries++) {
    const first = await listen(0);
    if (first === undefined) continue;
    const base = first.address().port;
    const run = [first];
    for (let i = 1; i < block && base + i < 65536; i++) {
      const server = await listen(base + i);
      if (server === undefined) break;
      run.push(server);
    }
    if (run.length === block) held = run;
    else for (const server of run) server.close();
  }
  if (held.length === 0) process.exit(1);
  const web = await listen(0);
  const layout = await listen(0);
  process.stdout.write(JSON.stringify({ host: held[0].address().port, web: web.address().port, layout: layout.address().port }));
  for (const server of [...held, web, layout]) server.close();
})();
`;

/**
 * Gives this e2e run ports of its own (#37). e2e/config.ts calls it first, so in the runner process, which loads the
 * Playwright config, it sets them in the environment the web servers and workers inherit. A run given its ports
 * already (all three set) keeps them, and the workers and web servers find them set.
 */
export function ensureRunPorts(): void {
  if (NAMES.every((name) => process.env[name] !== undefined)) return;
  const picked = spawnSync(process.execPath, ["-e", PICK], {
    env: { ...process.env, E2E_HOST_BLOCK: String(HOST_BLOCK) },
    encoding: "utf8",
  });
  if (picked.status !== 0) throw new Error(`could not find free ports for this e2e run: ${picked.stderr}`);
  const ports = JSON.parse(picked.stdout) as { host: number; web: number; layout: number };
  process.env["E2E_HOST_PORT"] = String(ports.host);
  process.env["E2E_WEB_PORT"] = String(ports.web);
  process.env["E2E_LAYOUT_PORT"] = String(ports.layout);
}
