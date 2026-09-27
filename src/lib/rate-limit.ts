import 'server-only';

/**
 * A small fixed-window rate limit, kept in memory.
 *
 * Every voice call costs the project ElevenLabs credits, so the voice routes cap
 * each signed-in user per window. It is per server instance, not global, which
 * is enough to stop a runaway loop from draining the quota during a demo
 * weekend. clientIp() is here for any route that has to limit signed-out
 * callers instead.
 */

const buckets = new Map<string, { count: number; resetAt: number }>();

export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'local';
}

/** True if this call is allowed; counts it either way. */
export function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    // Sweep now and then so the map does not grow for the life of the process.
    if (buckets.size > 5000) for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    return true;
  }
  bucket.count++;
  return bucket.count <= limit;
}

export function tooMany() {
  return Response.json({ error: 'Too many requests. Try again in a few minutes.' }, { status: 429 });
}
