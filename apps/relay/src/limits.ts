import { sourceKey } from "./source-ip.ts";

/** A host must answer its challenge within this long. */
export const AUTH_TIMEOUT_MS = 10_000;

/** The connecting address Cloudflare stamps on the request, as a rate-limit key (IPv6 per /64). */
export function sourceOf(request: Request): string {
  return sourceKey(request.headers.get("cf-connecting-ip") ?? "unknown");
}

/** One token per request, keyed by the connecting source. */
export async function allowFromIp(limiter: RateLimit, request: Request): Promise<boolean> {
  const { success } = await limiter.limit({ key: sourceOf(request) });
  return success;
}
