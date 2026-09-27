import { readBoard, readMatchMap } from '@/lib/pipeline';
import { emptyBoard } from '@/lib/pipeline-contract';
import { requireApplicant } from '@/lib/require-applicant';
import { sql } from '@/lib/sql';

export const dynamic = 'force-dynamic';

/**
 * The signed-in applicant's pipeline board. `stages` always has all seven
 * keys, empty or not. Read-only: stages change through POST /api/pipeline/status.
 */
export async function GET(request: Request) {
  const user = await requireApplicant(request);
  if (user instanceof Response) return user;
  const started = Date.now();

  try {
    const matches = await readMatchMap(sql, user.id);
    const board = await readBoard(sql, user.id, matches);
    return Response.json({ ...board, took_ms: Date.now() - started });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ ...emptyBoard(), error: message, took_ms: Date.now() - started }, { status: 502 });
  }
}
