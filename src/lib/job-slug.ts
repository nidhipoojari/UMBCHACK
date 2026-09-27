/**
 * job-slug.ts — how a job_id survives being a path segment.
 *
 * THE BUG THIS EXISTS TO FIX. A job_id is the posting's own URL —
 * `https://boards.greenhouse.io/chime/jobs/8765684002?gh_jid=8765684002`.
 * Putting that in `/applicant/jobs/[jobId]` with encodeURIComponent produces
 * `%2F%2F`, which Next normalises back to `//` and then collapses to `/`, so
 * the request that actually leaves the browser is
 * `/applicant/jobs/https:/boards.greenhouse.io/...` and no route matches it.
 * A 404 on every job card.
 *
 * Percent-encoding is the wrong tool because the router is entitled to
 * normalise it — the slash is structural in a path, and escaping it only asks
 * the router to please not mean it. base64url has no reserved character at
 * all, so there is nothing left to normalise: the segment survives the router,
 * the CDN and a copy-paste into a chat window.
 *
 * OLD LINKS STILL WORK. `fromJobSlug` falls back to returning the segment
 * unchanged when it does not decode to something that looks like a job_id.
 * Links were shared while the raw form was live, and a shared link that
 * 404s is the failure this module is here to stop, not one to introduce from
 * the other direction.
 */

/**
 * NO Buffer HERE. This module is imported by client components — the match
 * list, the pipeline board — so it runs in the browser, where `Buffer` is a
 * polyfill that does not implement the 'base64url' encoding and throws
 * "Unknown encoding: base64url" while rendering. btoa/atob and TextEncoder are
 * global in both the browser and Node 20, so one implementation is correct in
 * both places and there is no second path to keep in step.
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  // A loop rather than String.fromCharCode(...bytes): spreading a large array
  // into arguments overflows the call stack, and a job_id is only short today.
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** A job_id as a path segment: no slashes, no query, nothing to normalise. */
export function toJobSlug(jobId: string): string {
  return bytesToBase64(new TextEncoder().encode(jobId))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * The job_id a slug names.
 *
 * Anything that is not a clean round trip is returned as-is rather than
 * throwing: a caller holding an old-style link, or a hand-typed URL, should
 * get a lookup that misses and renders "no such posting" — not a crash.
 */
export function fromJobSlug(slug: string): string {
  try {
    const padded = slug.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    // A job_id is a URL. Requiring that shape is what keeps a legacy segment
    // that happens to be valid base64 from being silently mangled into
    // mojibake — base64url will "decode" almost anything.
    if (/^https?:\/\//i.test(decoded)) return decoded;
  } catch {
    // fall through
  }
  // Legacy links, and anything else, are passed through untouched.
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}
