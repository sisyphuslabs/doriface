import { runScenario } from "./scenario.ts";

const result = Promise.all([runScenario("/ours.wasm"), runScenario("/stock.wasm")]).then(([ours, stock]) => ({
  ours,
  stock,
}));
Reflect.set(globalThis, "ghosttyScenario", result);
dispatchEvent(new Event("ghostty-scenario"));
