import type { Role } from '@/lib/users';

import type { WorkspaceLink } from './WorkspaceNav';

/**
 * Each workspace's destinations, ordered as the work happens.
 *
 * Applicant: find a role, track it, then let the agent make the approved
 * introduction and show the receipt in one place.
 *
 * Jobs is both the first step and the landing page — `/applicant` redirects to
 * it. There was an Overview above it, and it had no question of its own: it
 * listed the top three of the same matches Jobs lists in full, beside an
 * invented activity feed that repeated what /applicant/activity already showed.
 *
 * Agents sits between sending and the activity log because that is where the
 * question it answers gets asked — "who did that just go to, and why did the
 * other side refuse?" Profile sits last because it is not a step in the work;
 * it is what the work is done from. Employer: see what came in, go looking for
 * people who have not applied yet, then the audit trail.
 */
export const WORKSPACE_LINKS: Record<Role, readonly WorkspaceLink[]> = {
  applicant: [
    { href: '/applicant/jobs', label: 'Jobs', key: 'jobs' },
    { href: '/applicant/pipeline', label: 'Pipeline', key: 'pipeline' },
    { href: '/applicant/network', label: 'Network', key: 'network' },
    { href: '/applicant/agents', label: 'Agents', key: 'agents' },
    { href: '/applicant/activity', label: 'Activity', key: 'activity' },
    { href: '/applicant/profile', label: 'Profile', key: 'profile' },
  ],
  employer: [
    { href: '/employer', label: 'Overview', key: 'overview' },
    { href: '/employer/applicants', label: 'Applicants', key: 'applicants' },
    { href: '/employer/candidates', label: 'Find candidates', key: 'candidates' },
    { href: '/employer/activity', label: 'Activity', key: 'activity' },
  ],
};

/**
 * Where signing in lands, per workspace.
 *
 * Not always `/${role}`: /applicant redirects to /applicant/jobs, so the
 * onboarding gate in WorkspaceShell would never recognise the landing page as
 * the root and would stop firing. Named here, beside the links, so the two
 * cannot drift apart.
 */
export const WORKSPACE_ROOT: Record<Role, string> = {
  applicant: '/applicant/jobs',
  employer: '/employer',
};

export const WORKSPACE_LABEL: Record<Role, string> = {
  applicant: 'Workspace',
  employer: 'Hiring workspace',
};

/** The account screen, reached from the nav's foot. */
export const ACCOUNT_HREF: Record<Role, string> = {
  applicant: '/applicant/account',
  employer: '/employer/account',
};

/** Pages with no link of their own, and the section they sit under. */
const SECTION_OF: Record<string, string> = {
  '/applicant/interview': '/applicant/pipeline',
};

/** The link a path belongs to: the longest href that prefixes it. */
export function currentLink(role: Role, pathname: string): WorkspaceLink | null {
  for (const [prefix, section] of Object.entries(SECTION_OF)) {
    if (pathname.startsWith(`${prefix}/`)) pathname = section;
  }
  let best: WorkspaceLink | null = null;
  for (const link of WORKSPACE_LINKS[role]) {
    const matches = pathname === link.href || pathname.startsWith(`${link.href}/`);
    if (matches && (!best || link.href.length > best.href.length)) best = link;
  }
  return best;
}
