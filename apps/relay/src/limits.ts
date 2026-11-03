/** A host must answer its challenge within this long. */
export const AUTH_TIMEOUT_MS = 10_000;

/** One token per request, keyed by the connecting IP that Cloudflare stamps on it. */
export async function allowFromIp(limiter: RateLimit, request: Request): Promise<boolean> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const { success } = await limiter.limit({ key: ip });
  return success;
}
