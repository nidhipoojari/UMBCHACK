import { callAtsWorker, hasAtsWorker } from '@/lib/ats-worker';
import { planFieldValues, type DiscoveredField, type PlannedField } from '@/lib/autofill/gemini-fill';
import { loadAutofillProfile } from '@/lib/autofill/evidence';
import { assessCompany } from '@/lib/company-check';
import { employerDomainFromPosting, getJob } from '@/lib/jobs';
import { requireApplicant } from '@/lib/require-applicant';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

type Prepared = {
  status?: string;
  provider?: string;
  submitted?: boolean;
  fields_filled?: string[];
  fields_skipped?: { field: string; reason: string }[];
  spoken_reason?: string;
  screenshot_png?: string;
  error?: string;
};

/**
 * Prepares an application on the employer's own form (Greenhouse, Lever or
 * Ashby) using the ats-worker: read the live form, plan each field from the
 * applicant's profile with Gemini, type it in, screenshot it, and stop.
 * Nothing is submitted; the applicant reviews and sends it themselves.
 *
 *   POST { job_id } -> { job_id, prepared, company, planned_fields, ... }
 */
export async function POST(request: Request) {
  const user = await requireApplicant(request);
  if (user instanceof Response) return user;

  const body = (await request.json().catch(() => ({}))) as { job_id?: string };
  if (!body.job_id) return Response.json({ error: 'job_id is required.' }, { status: 400 });
  const job = await getJob(body.job_id);
  if (!job) return Response.json({ error: 'The selected job could not be found.' }, { status: 404 });
  if (!job.source_url) {
    return Response.json({ error: 'This posting has no application URL to fill.' }, { status: 422 });
  }

  if (!hasAtsWorker()) {
    return Response.json(
      {
        queued: true,
        configured: false,
        job_id: job.job_id,
        status: 'preparing',
        message: `Your agent is preparing an application for ${job.job_title} at ${job.company_name}. Nothing is submitted: it comes back for you to review.`,
        note: 'The form-filling worker is not configured here yet, so there is nothing to review at the moment.',
      },
      { status: 202 },
    );
  }

  // Checked again here rather than trusting what the page showed.
  const company = await assessCompany({
    postedDomain: employerDomainFromPosting(job),
    source: job.source,
    companyName: job.company_name ?? 'This company',
  });
  if (company.tier !== 'known_employer') {
    return Response.json(
      { error: `${job.company_name} did not pass the employer check, so no application was prepared.`, company },
      { status: 403 },
    );
  }

  const profile = await loadAutofillProfile(user.id).catch(() => null);
  const header = profile?.header ?? null;

  // Only facts that exist. A blank box is ten seconds of the applicant's time;
  // an invented value is a false claim on a real application.
  const candidate = Object.fromEntries(
    Object.entries({
      full_name: header?.fullName || user.name || '',
      email: header?.email || user.email || '',
      phone: header?.phone ?? '',
      location: header?.location ?? '',
      linkedin: header?.linkedinUrl ?? '',
      website: header?.portfolioUrl ?? '',
      github: header?.githubUrl ?? '',
    }).filter(([, value]) => typeof value === 'string' && value.trim() !== ''),
  );
  const missing = ['phone', 'location', 'linkedin', 'website'].filter((field) => !candidate[field]);

  // Best effort: without a plan the worker still fills the standard boxes.
  let planned: PlannedField[] = [];
  let discoveredCount = 0;
  try {
    const found = await callAtsWorker<{ fields?: DiscoveredField[] }>('/ats/discover', { job_url: job.source_url }, 60_000);
    if (found.ok) {
      const fields = found.body.fields ?? [];
      discoveredCount = fields.length;
      if (fields.length) {
        planned = await planFieldValues({
          jobTitle: job.job_title ?? '',
          company: job.company_name ?? '',
          evidence: profile?.evidence ?? '',
          fields,
        });
      }
    }
  } catch (error) {
    console.warn('[autofill] field planning skipped:', (error as Error).message);
  }

  try {
    const response = await callAtsWorker<Prepared>(
      '/ats/prepare',
      {
        job_url: job.source_url,
        candidate,
        planned: planned.filter((field) => field.value.trim() !== ''),
        // Never true from here: sending is the applicant's own act.
        submit: false,
      },
      120_000,
    );
    if (!response.ok) {
      return Response.json(
        { error: response.body.error ?? `The autofill worker returned HTTP ${response.status}.` },
        { status: 502 },
      );
    }
    return Response.json({
      job_id: job.job_id,
      prepared: response.body,
      company,
      fields_supplied: Object.keys(candidate),
      planned_fields: planned,
      fields_discovered: discoveredCount,
      needs_your_answer: planned.filter((field) => field.needsConfirmation).map((field) => field.label),
      fields_missing_from_profile: missing,
      profile_fact_count: profile?.factCount ?? 0,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error && error.name === 'TimeoutError'
            ? 'The autofill worker did not finish in time, so nothing was prepared.'
            : 'The autofill worker could not be reached, so nothing was prepared.',
      },
      { status: 502 },
    );
  }
}
