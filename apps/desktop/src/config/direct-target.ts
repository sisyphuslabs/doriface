const E2EE_PATH = "/v1/e2ee";
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * The address this shell may forward to, normalised to `ws(s)://host:port/v1/e2ee`, or undefined when the value names
 * anything else. The shell reads the page's saved setting and checks it here itself, so no request can choose a target.
 */
export function forwardedTarget(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  let url: URL;
  try {
    url = new URL(SCHEME.test(trimmed) ? trimmed : `ws://${trimmed}`);
  } catch {
    return undefined;
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") return undefined;
  if (url.hostname === "") return undefined;
  if (url.username !== "" || url.password !== "") return undefined;
  if (url.search !== "" || url.hash !== "") return undefined;
  if (url.pathname !== "/" && url.pathname !== E2EE_PATH) return undefined;
  return `${url.protocol}//${url.host}${E2EE_PATH}`;
}
