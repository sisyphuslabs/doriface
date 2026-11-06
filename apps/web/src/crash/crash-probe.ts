/**
 * A test hook: e2e sets `window.__dorifaceCrash` to a region's name before the page loads, and that region throws while
 * it renders, so each error boundary can be proven against a real throw. Nothing in the app sets it.
 */
export function crashProbe(region: string): void {
  if (Reflect.get(globalThis, "__dorifaceCrash") === region) throw new Error(`crash probe: ${region}`);
}

export function CrashProbe({ region }: { readonly region: string }): null {
  crashProbe(region);
  return null;
}
