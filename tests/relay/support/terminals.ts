export type HcRun = (args: readonly string[]) => string;

const END_WAIT_S = 60;

/**
 * Ends a terminal, then removes it. `hc kill` returns the state it observed once its hangup, terminate and kill steps are
 * done, and that can still be "live" while the kernel tears the program down (a loaded machine, or a large program);
 * `hc rm` refuses a live terminal ("t1 is still running", #469). A live result is waited out with `hc wait`, which
 * returns as the program ends.
 */
export function killAndRemove(hc: HcRun, address: string): void {
  const killed: unknown = JSON.parse(hc(["kill", "--json", address]));
  const state = typeof killed === "object" && killed !== null ? Reflect.get(killed, "state") : undefined;
  if (state !== "finished") hc(["wait", "--json", "--timeout", String(END_WAIT_S), address]);
  hc(["rm", address]);
}
