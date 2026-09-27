import 'server-only';

import { db } from '@/lib/db';

/**
 * A small query helper over the Postgres pool: named `:param` placeholders in,
 * `{ columns, rows }` out with every cell as a string (or null). Used by the
 * pipeline, job page and toolbox modules, which take it as an injected `sql`
 * so they can be exercised without a database.
 */
export type SqlParam = { name: string; value: string | number | boolean | null | undefined };
export type SqlResult = { columns: string[]; rows: (string | null)[][] };
export type SqlFn = (statement: string, parameters?: SqlParam[]) => Promise<SqlResult>;

// `:name`, but not the second colon of a `::type` cast.
const PLACEHOLDER = /(?<!:):([a-z_][a-z0-9_]*)/gi;

function cell(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export const sql: SqlFn = async (statement, parameters = []) => {
  const byName = new Map(parameters.map((param) => [param.name, param.value ?? null]));
  const order: string[] = [];
  const text = statement.replace(PLACEHOLDER, (match, name: string) => {
    if (!byName.has(name)) return match;
    let index = order.indexOf(name);
    if (index === -1) index = order.push(name) - 1;
    return `$${index + 1}`;
  });

  const client = await db.connect();
  try {
    const result = await client.query({
      text,
      values: order.map((name) => byName.get(name)),
      rowMode: 'array',
    });
    return {
      columns: result.fields.map((field) => field.name),
      rows: (result.rows as unknown[][]).map((row) => row.map(cell)),
    };
  } finally {
    client.release();
  }
};
