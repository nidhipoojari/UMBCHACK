import { redirect } from 'next/navigation';

/**
 * There is no Overview. `/applicant` is Jobs.
 *
 * The screen that used to live here listed the top three of the same
 * `/api/matches` response the Jobs page lists in full, beside a hardcoded
 * activity timeline that repeated three of the five invented events already on
 * /applicant/activity. Everything it owned outright — the greeting and the stat
 * tiles — is now at the top of Jobs, above the list those tiles are counted
 * from.
 *
 * A redirect rather than a deleted route: the path is in muscle memory, in the
 * onboarding hand-off and in whatever links were shared while it existed, and
 * all three should land somewhere rather than 404.
 */
export default function ApplicantIndex() {
  redirect('/applicant/jobs');
}
