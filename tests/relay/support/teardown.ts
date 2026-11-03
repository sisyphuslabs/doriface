import { afterAll } from "bun:test";
import { stopAdoptedGroups } from "./process-group.ts";

// Preloaded by bunfig.toml, so it runs once after every test file: `bun test` emits no process `exit` event, and a
// relay a test started and never stopped would otherwise outlive the run.
afterAll(stopAdoptedGroups, 60_000);
