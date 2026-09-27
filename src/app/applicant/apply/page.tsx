import { redirect } from 'next/navigation';

/** Keep old bookmarks working while Agents becomes the single action surface. */
export default function ApplyPage() {
  redirect('/applicant/agents');
}
