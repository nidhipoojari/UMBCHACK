import { analyze } from '@/lib/artifacts/analyze';
import { loadContext } from '@/lib/artifacts/context';
import { generateDocument, KINDS, type DraftKind } from '@/lib/artifacts/generate';
import { insertArtifact } from '@/lib/artifacts/store';
import { requireApplicant } from '@/lib/require-applicant';
import { sql } from '@/lib/sql';

export const dynamic = 'force-dynamic';

/** A draft is one model call; give it room. */
export const maxDuration = 300;

type Body = { kind?: unknown; angle?: unknown; question?: unknown };

/** Free text the applicant typed, trimmed and capped before it reaches a prompt. */
function shortText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

/**
 * Writes one draft for this job — { kind: 'cover_letter' | 'answers' | 'resume',
 * angle?, question? } — runs it through the fact gate, stores it with its
 * verdict, and returns both. Nothing is sent anywhere.
 */
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await requireApplicant(request);
  if (user instanceof Response) return user;
  const { jobId } = await params;

  const body = (await request.json().catch(() => ({}))) as Body;
  const kind = typeof body.kind === 'string' ? body.kind : '';
  if (!(kind in KINDS)) {
    return Response.json(
      { error: `kind must be one of ${Object.keys(KINDS).join(', ')}`, valid_kinds: Object.keys(KINDS) },
      { status: 400 },
    );
  }

  try {
    const context = await loadContext(sql, user.id, decodeURIComponent(jobId));
    if (!context.ok) return Response.json({ error: context.error }, { status: context.status });

    if (!context.job.has_description) {
      return Response.json(
        {
          error:
            `This posting has only ${context.job.description_chars} characters of description text, ` +
            'which is not enough to tailor anything to. Generating from it would produce a generic ' +
            'letter, and a generic letter is worse than none.',
        },
        { status: 422 },
      );
    }
    if (context.facts.factCount === 0) {
      return Response.json(
        {
          error:
            'Your profile has no saved facts yet, so there is nothing to write from and nothing to ' +
            'check against. Upload your resume first.',
        },
        { status: 422 },
      );
    }

    // The instant reads go to the model as already-worked-out facts.
    const analysis = analyze(context);
    const result = await generateDocument({
      kind: kind as DraftKind,
      job: context.job,
      facts: context.facts,
      profile: context.profile,
      analysis,
      angle: shortText(body.angle, 600),
      question: shortText(body.question, 400),
    });

    if (!result.ok) {
      return Response.json({ error: result.why, model_calls: result.model_calls, ms: result.ms }, { status: 502 });
    }

    // Stored whether it passed or not, so a refusal is on the record too. A save
    // failure is reported rather than withholding a document already written.
    let artifactId: string | null = null;
    let persistError: string | null = null;
    try {
      artifactId = await insertArtifact(sql, {
        userId: user.id,
        jobId: context.job.job_id,
        kind: KINDS[result.kind].kind,
        contentText: result.text,
        modelProvider: result.model_provider,
        modelName: result.model_name,
        verification: result.verification,
        sourceJobTitle: context.job.job_title,
      });
    } catch (error) {
      persistError = error instanceof Error ? error.message : String(error);
    }

    return Response.json({
      artifact_id: artifactId,
      persist_error: persistError,
      kind: result.kind,
      text: result.text,
      detail: result.detail,
      approach_reason: result.approach_reason,
      posting_anomaly: result.posting_anomaly,
      verification: result.verification,
      downloadable: result.downloadable,
      cost: {
        model_calls: result.model_calls,
        model_provider: result.model_provider,
        model_name: result.model_name,
        ms: result.ms,
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
