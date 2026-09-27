import { PageHead } from '@/components/workspace/PageHead';

export const metadata = { title: 'Pipeline · agentHire' };

const COLUMNS: { stage: string; cards: { title: string; company: string }[] }[] = [
  {
    stage: 'Saved',
    cards: [
      { title: 'ML Engineering Intern', company: 'Adatum AI' },
      { title: 'Cloud Support Associate', company: 'Litware' },
    ],
  },
  {
    stage: 'Applied',
    cards: [
      { title: 'Backend Engineering Intern', company: 'Northwind Labs' },
      { title: 'Data Platform Intern', company: 'Contoso Analytics' },
    ],
  },
  { stage: 'Interview', cards: [{ title: 'Full-Stack Developer Intern', company: 'Fabrikam' }] },
  { stage: 'Offer', cards: [] },
];

export default function PipelinePage() {
  return (
    <main id="main" className="ws-main">
      <PageHead eyebrow="Pipeline" title="Where every role stands.">
        Saved roles move right as they progress.
      </PageHead>
      <div className="ws-board">
        {COLUMNS.map((column) => (
          <section key={column.stage} className="ws-column" aria-label={column.stage}>
            <h2>
              {column.stage} <span>{column.cards.length}</span>
            </h2>
            {column.cards.length ? (
              column.cards.map((card) => (
                <article key={card.title} className="ws-card">
                  <h3>{card.title}</h3>
                  <p>{card.company}</p>
                </article>
              ))
            ) : (
              <p className="muted">Nothing here yet.</p>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
