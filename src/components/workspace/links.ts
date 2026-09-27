import type { Role } from '@/lib/users';

import type { WorkspaceLink } from './WorkspaceNav';

/**
 * Each workspace's destinations, ordered as the work happens.
 *
 * Applicant: find a role, track it, send it, then read back what the agent did.
 * Agents sits between sending and the activity log because that is where the
 * question it answers gets asked — "who did that just go to, and why did the
 * other side refuse?" Profile sits last because it is not a step in the work;
 * it is what the work is done from. Employer: see what came in, go looking for
 * people who have not applied yet, then the audit trail.
 */
export const WORKSPACE_LINKS: Record<Role, readonly WorkspaceLink[]> = {
  applicant: [
    { href: '/applicant', label: 'Overview', key: 'overview' },
    { href: '/applicant/jobs', label: 'Jobs', key: 'jobs' },
    { href: '/applicant/pipeline', label: 'Pipeline', key: 'pipeline' },
    { href: '/applicant/network', label: 'Network', key: 'network' },
    { href: '/applicant/apply', label: 'Verify & apply', key: 'apply' },
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
