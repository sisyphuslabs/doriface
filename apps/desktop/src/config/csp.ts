export interface CspOptions {
  /** The Vite dev server origin; relaxes script and style sources for its inline preamble and HMR. */
  readonly devServer?: string | undefined;
}

/**
 * The renderer's Content-Security-Policy. Terminals render through WebAssembly, and the client reaches the
 * loopback host, a LAN host or a relay over ws:/wss:, where every byte past the loopback is end-to-end encrypted.
 * Plain fetches stay on the loopback host; there is no blanket https: source to carry data anywhere else.
 */
export function contentSecurityPolicy(options: CspOptions = {}): string {
  const dev = options.devServer !== undefined;
  const inline = dev ? ["'unsafe-inline'"] : [];
  const directives: readonly (readonly string[])[] = [
    ["default-src", "'self'"],
    ["script-src", "'self'", "'wasm-unsafe-eval'", ...inline],
    ["style-src", "'self'", ...inline],
    ["img-src", "'self'", "data:", "blob:"],
    ["font-src", "'self'", "data:"],
    ["connect-src", "'self'", "ws:", "wss:", "http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*"],
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
