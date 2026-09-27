import { alumniRoster, cohortOptions, cohortStats, progressFor } from '@/lib/alumni';
import { verifyIdToken } from '@/lib/verify-token';

/**
 * The alumni roster for a cohort, with the student's progress.
 *
 * Identity comes from the verified Firebase token and never from the query
 * string: `connected` is per-user state, and taking the user id from the URL
 * would let anyone read anyone else's network by editing it.
 */
export async function GET(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!token) return Response.json({ error: 'Not signed in.' }, { status: 401 });

  let claims;
  try {
    claims = await verifyIdToken(token);
  } catch {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const major = url.searchParams.get('major') ?? 'Computer Science';
  const track = url.searchParams.get('track');

  const [agents, stats, progress, options] = await Promise.all([
    alumniRoster(claims.uid, major, track),
    cohortStats(major, track),
    progressFor(claims.uid),
    cohortOptions(),
  ]);

  return Response.json({ agents, stats, progress, options });
}
