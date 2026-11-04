import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { endAgent } from "./agents.ts";
import { coreDoc, setCoreDoc } from "./core-doc.ts";
import { hcOn } from "./machine-switch.ts";

const AGENT = join(import.meta.dirname, "fake-permission-agent.ts");

export interface AskingAgent {
  readonly address: string;
  /** Every key the agent received, in order (`"1"`, `"\u001B"`, `"x"`). */
  readonly keys: () => readonly string[];
  /** The records of the terminal's approval document on the core. */
  readonly records: () => readonly Record<string, unknown>[];
  /** A person pressing `keys` in the terminal itself, past doriface. */
  readonly typeInTerminal: (...keys: string[]) => void;
  /** Ends the agent, removes its terminal and its approval document, and deletes its key log. */
  readonly end: () => void;
}

/** Starts the fake Claude Code permission prompt on the e2e host's core, in its own space. */
export function startAskingAgent(name: string): AskingAgent {
  const dir = mkdtempSync(join(tmpdir(), "df-approval-"));
  const log = join(dir, "keys.log");
  const out = hcOn("host", ["run", "--bg", "--name", name, "--label", "space=approval", "--", "bun", AGENT, log]);
  const started: unknown = JSON.parse(out);
  if (typeof started !== "object" || started === null || !("address" in started)) throw new Error(out);
  const address = String(started.address);
  const doc = `approval.${address}`;
  return {
    address,
    keys: () =>
      existsSync(log)
        ? readFileSync(log, "utf8")
            .split("\n")
            .filter((line) => line !== "")
            .map((line) => String(JSON.parse(line)))
        : [],
    records: () => {
      const got = coreDoc(doc);
      const value = typeof got === "object" && got !== null ? Reflect.get(got, "value") : undefined;
      const records = typeof value === "object" && value !== null ? Reflect.get(value, "records") : undefined;
      return Array.isArray(records) ? records : [];
    },
    typeInTerminal: (...keys) => void hcOn("host", ["keys", address, ...keys]),
    end: () => {
      endAgent("host", address);
      setCoreDoc(doc, null);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
