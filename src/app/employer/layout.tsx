/**
 * NO CACHED WORKSPACE PAGES, and this is a bug fix rather than a tuning knob.
 *
 * These shells were being served `Cache-Control: max-age=3600`, so a signed-in
 * person kept the HTML — and therefore the chunk hashes it points at — for an
 * hour after a deploy. Twice now a feature has shipped, been confirmed live at
 * the origin, and still been invisible in the browser: the page was current,
 * the bundle it loaded was not. That failure is indistinguishable from the
 * feature being broken, which is the worst property a caching policy can have.
 *
 * force-dynamic makes Next send no-store instead. It is the honest setting for
 * this subtree regardless of the bug: every page under it is per-user and
 * behind Firebase auth, so a shared cache had nothing correct to hold anyway.
 */
export const dynamic = 'force-dynamic';

import { WorkspaceShell } from '@/components/workspace/WorkspaceShell';

export default function EmployerLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <WorkspaceShell role="employer">{children}</WorkspaceShell>;
}
