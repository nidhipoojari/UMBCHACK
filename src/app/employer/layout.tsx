import { WorkspaceShell } from '@/components/workspace/WorkspaceShell';

export default function EmployerLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <WorkspaceShell role="employer">{children}</WorkspaceShell>;
}
