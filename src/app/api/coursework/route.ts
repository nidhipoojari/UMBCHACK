import { ensureTwin, getCoursework } from '@/lib/coursework';
import { requireApplicant } from '@/lib/require-applicant';

/**
 * The applicant's coursework stand-in from the hackUMBC dataset.
 *
 *   GET  200 { coursework: Coursework | null }   null until they have been matched
 *   POST 200 { twin: TwinSummary }               match now if not matched yet; idempotent
 *        409 no parsed resume to match from
 *
 * POST is what the onboarding progress page calls once the resume is parsed.
 * Calling it again, or after a new upload, returns the same twin: the match is
 * made once per applicant and never changes.
 */
export async function GET(request: Request) {
  const user = await requireApplicant(request);
  if (user instanceof Response) return user;
  return Response.json({ coursework: await getCoursework(user.id) });
}

export async function POST(request: Request) {
  const user = await requireApplicant(request);
  if (user instanceof Response) return user;
  try {
    const twin = await ensureTwin(user.id);
    if (!twin) return Response.json({ error: 'Upload a resume first.' }, { status: 409 });
    return Response.json({ twin });
  } catch (error) {
    console.error('coursework match failed', error);
    return Response.json({ error: 'We could not match your coursework right now.' }, { status: 502 });
  }
}
