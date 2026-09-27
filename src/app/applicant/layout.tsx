import { WorkspaceShell } from '@/components/workspace/WorkspaceShell';

export default function ApplicantLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <WorkspaceShell role="applicant">{children}</WorkspaceShell>;
}
