import { FlaskConical } from 'lucide-react';

/** The top of every workspace page. `sample` marks a page whose data is placeholder. */
export function PageHead({
  eyebrow,
  title,
  children,
  sample = true,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
  sample?: boolean;
}) {
  return (
    <header className="ws-head">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {children ? <p>{children}</p> : null}
      {sample ? (
        <span className="ws-sample">
          <FlaskConical size={14} aria-hidden="true" />
          Sample data for now
        </span>
      ) : null}
    </header>
  );
}

export function Stats({ items }: { items: readonly { label: string; value: string }[] }) {
  return (
    <ul className="ws-stats">
      {items.map((item) => (
        <li key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </li>
      ))}
    </ul>
  );
}

export type Row = { title: string; meta: string; pill?: string; solid?: boolean; figure?: string };

export function Rows({ rows }: { rows: readonly Row[] }) {
  return (
    <ul className="ws-list">
      {rows.map((row) => (
        <li key={row.title} className="ws-row">
          <div>
            <h3>{row.title}</h3>
            <p>{row.meta}</p>
          </div>
          {row.pill ? <span className={`ws-pill${row.solid ? ' ws-pill--solid' : ''}`}>{row.pill}</span> : <span />}
          {row.figure ? <strong>{row.figure}</strong> : <span />}
        </li>
      ))}
    </ul>
  );
}

export type Moment = { when: string; title: string; detail: string };

export function Timeline({ items }: { items: readonly Moment[] }) {
  return (
    <ol className="ws-timeline">
      {items.map((item) => (
        <li key={item.title + item.when}>
          <time>{item.when}</time>
          <div>
            <h3>{item.title}</h3>
            <p>{item.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
