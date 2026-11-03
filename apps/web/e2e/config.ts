import { tmpdir } from "node:os";
import { join } from "node:path";

export const E2E_HOST_PORT = 7799;
/** Shared by the e2e host and the specs: the added machine's switch and environment. */
export const E2E_MACHINE_DIR = join(tmpdir(), `doriface-web-e2e-${E2E_HOST_PORT}-machine`);
export const E2E_WEB_PORT = 4173;
/** A throwaway token for a loopback-only test host. */
export const E2E_TOKEN = "doriface-e2e-loopback-token-0000";
