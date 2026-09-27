import { cohortStats } from '@/lib/alumni';
import { gameStateFor } from '@/lib/game';
import { verifyIdToken } from '@/lib/verify-token';

/**
 * The signed-in student's game state: energy, streak, level, achievements.
 *
 * Identity comes from the verified Firebase token and NEVER from the query
 * string. This endpoint is the one place that says how far along a named
 * person is, so a `?uid=` would turn every student's progress into a public
 * page for anyone who could guess a uid. `major` and `track` are read from the
 * URL because they are not identity — they choose which cohort the route
 * shares are measured against, exactly as /api/alumni does, and the defaults
 * match that route so the two screens describe the same cohort.
 *
 * NOTHING HERE WRITES. Every field is derived from rows that already exist
 * (see lib/game.ts), so a GET cannot change a score — which also means the
 * page is safe to poll and safe to reload twice.
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

  const stats = await cohortStats(major, track);
  const game = await gameStateFor(claims.uid, stats.routes);

  return Response.json(game);
}
