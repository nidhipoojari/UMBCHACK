import { loadProfileData } from '@/lib/artifacts/facts';
import { loadJob } from '@/lib/artifacts/job';
import { renderBlockedHtml, renderDocumentHtml, renderNoticeHtml, renderResumeHtml } from '@/lib/artifacts/render-html';
import { getArtifact } from '@/lib/artifacts/store';
import { requireApplicant } from '@/lib/require-applicant';
import { sql } from '@/lib/sql';

export const dynamic = 'force-dynamic';

const HTML = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
  'x-content-type-options': 'nosniff',
} as const;

const KIND_TITLE: Record<string, string> = {
  cover_letter: 'Cover letter',
  answers: 'Application answers',
  resume: 'Tailored resume bullets',
  email: 'Email draft',
  analysis: 'Analysis',
};

function htmlResponse(body: string, status = 200) {
  return new Response(body, { status, headers: HTML });
}

/**
 * The print view for one stored document, or for `resume`: the applicant's
 * profile laid out as a resume with no model call. It re-reads the stored
 * verdict and refuses a document that failed the fact check on its own
 * authority, whatever the page offered. The page fetches this with the
 * applicant's token and opens the HTML in a new tab.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string; artifactId: string }> },
) {
  const user = await requireApplicant(request);
  if (user instanceof Response) return user;
  const { jobId, artifactId } = await params;
  const decodedArtifactId = decodeURIComponent(artifactId);

  try {
    const job = await loadJob(sql, decodeURIComponent(jobId));
    if (!job) {
      return htmlResponse(
        renderNoticeHtml({ title: 'Unknown posting', message: 'No posting with that id exists, so there is nothing to print against it.' }),
        404,
      );
    }

    if (decodedArtifactId === 'resume') {
      const { facts } = await loadProfileData(sql, user.id);
      if (facts.factCount === 0) {
        return htmlResponse(
          renderNoticeHtml({
            title: 'Resume',
            message: 'Your profile has no saved facts yet, so there is no resume to render. Upload your resume first.',
          }),
          422,
        );
      }
      return htmlResponse(
        renderResumeHtml({
          structured: facts.structured,
          generatedAt: new Date().toISOString().slice(0, 10),
          note:
            `Assembled from the ${facts.factCount} facts in your profile with no model call. ` +
            'Every line is something you told us; nothing here was written for you.',
        }),
      );
    }

    // Missing and someone else's get the same answer.
    const artifact = await getArtifact(sql, user.id, decodedArtifactId);
    if (!artifact || artifact.job_id !== job.job_id) {
      return htmlResponse(
        renderNoticeHtml({ title: 'Not found', message: 'No document with that id exists for this posting in your account.' }),
        404,
      );
    }

    if (!artifact.downloadable) {
      return htmlResponse(
        renderBlockedHtml({
          title: KIND_TITLE[artifact.kind] ?? artifact.kind,
          findings: (artifact.verification?.findings as { claim: string; severity: string; reason: string }[]) ?? [],
          sentence:
            artifact.verification?.sentence ??
            'This document did not pass the fact check against your profile, so no printable version exists.',
        }),
        403,
      );
    }

    return htmlResponse(
      renderDocumentHtml({
        title: KIND_TITLE[artifact.kind] ?? artifact.kind,
        subtitle: [artifact.source_job_title, job.company_name].filter(Boolean).join(' · '),
        text: artifact.content_text,
        generatedAt: artifact.created_at,
        modelName: artifact.model_name,
      }),
    );
  } catch (error) {
    return htmlResponse(
      renderNoticeHtml({
        title: 'Could not open the print view',
        message: `${error instanceof Error ? error.message : String(error)} Reloading usually fixes it.`,
      }),
      502,
    );
  }
}
