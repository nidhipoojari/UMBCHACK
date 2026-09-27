import { CourseworkCard } from '@/components/workspace/CourseworkCard';
import { PageHead } from '@/components/workspace/PageHead';
import { ProfileFacts } from '@/components/workspace/ProfileFacts';

export const metadata = { title: 'Profile · agentHire' };

const SAMPLE_SKILLS = ['Python', 'TypeScript', 'React', 'PostgreSQL', 'Google Cloud', 'Machine learning'];

export default function ProfilePage() {
  return (
    <main id="main" className="ws-main">
      <PageHead eyebrow="Profile" title="What your agent works from." sample={false}>
        Built from your resume. The details below are what we have on file.
      </PageHead>
      <ProfileFacts role="applicant" />
      <CourseworkCard />
      <section className="ws-section" aria-labelledby="skills-h">
        <header>
          <h2 id="skills-h">Skills</h2>
          <span className="ws-sample">Sample data for now</span>
        </header>
        <ul className="ws-tags">
          {SAMPLE_SKILLS.map((skill) => (
            <li key={skill}>{skill}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
