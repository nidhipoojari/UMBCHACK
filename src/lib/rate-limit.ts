import 'server-only';

/**
 * A small fixed-window rate limit, kept in memory.
 *
 * The landing page's voice agent works without signing in, so every call it
 * makes costs the project credits on behalf of an anonymous visitor. This caps
 * each visitor (by IP) per window. It is per server instance, not global, which
 * is enough to stop a script from draining the ElevenLabs and Gemini quotas
 * during a demo weekend.
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
