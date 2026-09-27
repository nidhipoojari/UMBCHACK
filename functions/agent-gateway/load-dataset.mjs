/**
 * load-dataset.mjs — loads the FULL hackUMBC dataset into Postgres.
 *
 * Streams each CSV straight from the source repo into COPY. Nothing is staged
 * on disk, so the 13 MB transcripts file never has to fit anywhere.
 *
 * EVERY COLUMN IS TEXT, deliberately. The dataset uses the literal string
 * "Not Applicable" as a sentinel inside otherwise-numeric columns — a
 * certification has no hours_per_week, an alum who went to grad school has no
 * first_job_annual_salary_usd. Typing those as INTEGER would fail the load
 * outright. The upstream docs are explicit that such columns "load as text, so
 * filter before casting", and reproducing that here keeps the database honest
 * about what the data actually is rather than lying in the schema and breaking
 * at 03:00.
 *
 * Tables are named WITHOUT the sample_ prefix, alongside the existing sample_*
 * tables rather than replacing them: another person is building against those
 * right now, and silently swapping the rows under them would be the worst of
 * both options.
 */
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { from as copyFrom } from 'pg-copy-streams';
import { client, query } from './lib/db.mjs';

const BASE = 'https://raw.githubusercontent.com/jasonpaluck/hackumbc-2026/main/data';
const FILES = [
  'students_current', 'alumni', 'transcripts',
  'employment_history', 'student_experience', 'course_catalog',
];

// The join keys, per the upstream docs: campus_id is the only person key and
// course_id joins transcripts to the catalogue.
const INDEXES = {
  transcripts: ['campus_id', 'course_id'],
  employment_history: ['campus_id'],
  student_experience: ['campus_id'],
  students_current: ['campus_id'],
  alumni: ['campus_id'],
  course_catalog: ['course_id'],
};

const ident = s => '"' + String(s).replace(/"/g, '""') + '"';

for (const name of FILES) {
  const url = `${BASE}/${name}.csv`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const text = await res.text();

  const headerLine = text.slice(0, text.indexOf('\n')).replace(/\r$/, '');
  const cols = headerLine.split(',').map(c => c.trim());

  await query(`DROP TABLE IF EXISTS ${ident(name)}`);
  await query(`CREATE TABLE ${ident(name)} (${cols.map(c => `${ident(c)} TEXT`).join(', ')})`);

  const c = await client();
  try {
    const stream = c.query(copyFrom(`COPY ${ident(name)} FROM STDIN WITH (FORMAT csv, HEADER true)`));
    await pipeline(Readable.from([text]), stream);
  } finally {
    c.release();
  }

  for (const col of INDEXES[name] ?? []) {
    if (cols.includes(col)) {
      await query(`CREATE INDEX IF NOT EXISTS ${ident(`${name}_${col}_idx`)} ON ${ident(name)} (${ident(col)})`);
    }
  }

  const { rows } = await query(`SELECT count(*)::bigint AS n FROM ${ident(name)}`);
  console.log(`${name.padEnd(20)} ${String(rows[0].n).padStart(7)} rows, ${cols.length} cols`);
}

console.log('full dataset loaded');
process.exit(0);
