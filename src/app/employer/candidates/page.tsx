import { PageHead, Rows } from '@/components/workspace/PageHead';

export const metadata = { title: 'Find candidates · agentHire' };

export default function CandidatesPage() {
  return (
    <main id="main" className="ws-main">
      <PageHead eyebrow="Find candidates" title="People who have not applied yet.">
        Students whose profiles fit your open roles. Inviting one asks their agent first.
      </PageHead>
      <section className="ws-section" aria-labelledby="found-h">
        <header>
          <h2 id="found-h">Suggested</h2>
        </header>
        <Rows
          rows={[
            { title: 'Taylor Nguyen', meta: 'Python, Postgres, GCP · UMBC, CS 2026', pill: 'Open to work', figure: '89' },
            { title: 'Chris Okafor', meta: 'React, Node, TypeScript · UMBC, IS 2027', pill: 'Open to work', figure: '85' },
            { title: 'Dana Morales', meta: 'Spark, SQL, Airflow · UMD, CS 2026', pill: 'Invited', solid: true, figure: '82' },
          ]}
        />
      </section>
    </main>
  );
}
