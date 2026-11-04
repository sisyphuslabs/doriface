import { tmpdir } from "node:os";
import { join } from "node:path";

/** A port from the environment, so a second checkout on the same computer can run the suite beside the first. */
function port(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * The Playwright worker slot running this module (0..workers-1, reused when a worker restarts; 0 outside a worker).
 * Each slot has its own e2e host, so workers never share a core.
 */
export const E2E_SLOT = Number(process.env["TEST_PARALLEL_INDEX"] ?? 0) || 0;
/** Slot n's host listens on the base port plus n; the layout host sits below the base. */
export const hostPortOf = (slot: number): number => port("E2E_HOST_PORT", 7799) + slot;
/** This worker's e2e host. */
export const E2E_HOST_PORT = hostPortOf(E2E_SLOT);
/** Shared by the e2e host and the specs: the added machine's switch and environment. */
export const E2E_MACHINE_DIR = join(tmpdir(), `doriface-web-e2e-${E2E_HOST_PORT}-machine`);
/** Where the e2e host on `port` saves its core's environment (and its pid) for the specs and the leftover check. */
export const hostEnvOf = (port: number): string => join(tmpdir(), `doriface-web-e2e-${port}-host.json`);
/** This worker's core environment, so a spec can start terminals on it with hc. */
export const E2E_HOST_ENV = hostEnvOf(E2E_HOST_PORT);
export const E2E_WEB_PORT = port("E2E_WEB_PORT", 4173);
/** A second e2e host whose names, titles and paths are long, Korean or unbroken, for the layout spec. */
export const E2E_LAYOUT_PORT = port("E2E_LAYOUT_PORT", 7798);
export const E2E_LAYOUT_MACHINE_DIR = join(tmpdir(), `doriface-web-e2e-${E2E_LAYOUT_PORT}-machine`);
/** A throwaway token for a loopback-only test host. */
export const E2E_TOKEN = "doriface-e2e-loopback-token-0000";
