export interface CspOptions {
  /** The Vite dev server origin; relaxes script and style sources for its inline preamble and HMR. */
  readonly devServer?: string | undefined;
}

/**
 * The renderer's Content-Security-Policy. Terminals render through WebAssembly, and the client reaches the
 * loopback host, a LAN host or a relay over ws:/wss:, where every byte past the loopback is end-to-end encrypted.
 * Plain fetches stay on the loopback host; there is no blanket https: source to carry data anywhere else.
 */
/**
 * The one inline style the renderer needs: Base UI's scroll areas insert `<style>` with
 * `.base-ui-disable-scrollbar{scrollbar-width:none}...` to hide the native scrollbar under their own (#499). Allowed by
 * its hash, so style-src stays strict: any other inline style is still refused. test/config.test.ts recomputes it from
 * Base UI's own source, so an upgrade that changes the rule fails there instead of bringing the native scrollbar back.
 */
export const BASE_UI_SCROLLBAR_STYLE_HASH = "'sha256-kLmvWqfziFavKtqHqRsb90f006UAK2Dmd0It5Iz2KFA='";

export function contentSecurityPolicy(options: CspOptions = {}): string {
  const dev = options.devServer !== undefined;
  const inline = dev ? ["'unsafe-inline'"] : [];
  const directives: readonly (readonly string[])[] = [
    ["default-src", "'self'"],
    ["script-src", "'self'", "'wasm-unsafe-eval'", ...inline],
    ["style-src", "'self'", BASE_UI_SCROLLBAR_STYLE_HASH, ...inline],
    ["img-src", "'self'", "data:", "blob:"],
    ["font-src", "'self'", "data:"],
    ["connect-src", "'self'", "ws:", "wss:", "http://127.0.0.1:*", "http://localhost:*"],
    ["worker-src", "'self'", "blob:"],
    ["manifest-src", "'self'"],
    ["media-src", "'none'"],
    ["object-src", "'none'"],
    ["frame-src", "'none'"],
    ["frame-ancestors", "'none'"],
    ["base-uri", "'none'"],
    ["form-action", "'none'"],
  ];
  return directives.map((directive) => directive.join(" ")).join("; ");
}
