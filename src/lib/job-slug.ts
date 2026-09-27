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

/** A job_id as a path segment: no slashes, no query, nothing to normalise. */
export function toJobSlug(jobId: string): string {
  return Buffer.from(jobId, 'utf8').toString('base64url');
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
    const decoded = Buffer.from(slug, 'base64url').toString('utf8');
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
