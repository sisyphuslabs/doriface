import { tmpdir } from "node:os";
import { join } from "node:path";

/** A port from the environment, so a second checkout on the same computer can run the suite beside the first. */
function port(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export const E2E_HOST_PORT = port("E2E_HOST_PORT", 7799);
/** Shared by the e2e host and the specs: the added machine's switch and environment. */
export const E2E_MACHINE_DIR = join(tmpdir(), `doriface-web-e2e-${E2E_HOST_PORT}-machine`);
/** The e2e core's own environment, so a spec can start terminals on it with hc. */
export const E2E_HOST_ENV = join(tmpdir(), `doriface-web-e2e-${E2E_HOST_PORT}-host.json`);
export const E2E_WEB_PORT = port("E2E_WEB_PORT", 4173);
/** A second e2e host whose names, titles and paths are long, Korean or unbroken, for the layout spec. */
export const E2E_LAYOUT_PORT = port("E2E_LAYOUT_PORT", 7798);
/** The layout spec's core environment, so each spec starts with no tabs saved there either. */
export const E2E_LAYOUT_ENV = join(tmpdir(), `doriface-web-e2e-${E2E_LAYOUT_PORT}-host.json`);
export const E2E_LAYOUT_MACHINE_DIR = join(tmpdir(), `doriface-web-e2e-${E2E_LAYOUT_PORT}-machine`);
/** A throwaway token for a loopback-only test host. */
export const E2E_TOKEN = "doriface-e2e-loopback-token-0000";
