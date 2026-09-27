import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import {
  emptyBoard,
  toStage,
  type PipelineBoard,
  type PipelineSource,
  type PipelineStatus,
} from '@/lib/pipeline-contract';
import type { SqlFn, SqlResult } from '@/lib/sql';

/**
 * The application pipeline (sql/007_application_events.sql). Setting a stage
 * appends an event; the board reads the latest_application_state view. Nothing
 * here updates or deletes. Every value is a bound parameter, notes included.
 */

/** sha256(user_id|job_id): one application per user per job, by construction. */
export function applicationId(userId: string, jobId: string): string {
  return createHash('sha256').update(`${userId}|${jobId}`).digest('hex').slice(0, 32);
}

function objects(result: SqlResult): Record<string, string | null>[] {
  return result.rows.map((row) => {
    const out: Record<string, string | null> = {};
    result.columns.forEach((name, index) => {
      out[name] = row[index] ?? null;
    });
    return out;
  });
}

export type MarkResult = {
  ok: true;
  job_id: string;
  status: PipelineStatus;
  /** The stage before this one; null the first time. */
  previous_status: PipelineStatus | null;
  /** When the event was written, ISO 8601. */
  at: string;
};

export class UnknownJobError extends Error {
  constructor(public readonly jobId: string) {
    super(`job_id ${jobId} is not in job_snapshots`);
    this.name = 'UnknownJobError';
  }
}

/**
 * Appends one stage event, after checking the job exists and reading the stage
 * it is leaving. Two writes racing can both report the same previous stage;
 * both events are still kept and the view picks one winner.
 */
export async function markStatus(
  sql: SqlFn,
  input: { userId: string; jobId: string; status: PipelineStatus; note?: string | null; source: PipelineSource },
): Promise<MarkResult> {
  const { userId, jobId, status, source } = input;
  const note = input.note?.trim() ? input.note.trim() : null;

  const probe = await sql(
    `SELECT (SELECT COUNT(1) FROM job_snapshots WHERE job_id = :job_id) AS job_count,
            (SELECT current_state FROM latest_application_state
              WHERE user_id = :user_id AND job_id = :job_id) AS previous_status`,
    [
      { name: 'job_id', value: jobId },
      { name: 'user_id', value: userId },
    ],
  );
  const probed = objects(probe)[0] ?? {};
  if (Number(probed.job_count ?? '0') === 0) throw new UnknownJobError(jobId);
  const previous = toStage(probed.previous_status);

  const at = new Date().toISOString();
  await sql(
    `INSERT INTO application_events
       (event_id, application_id, user_id, job_id, event_type, event_source, event_at, note, metadata_json)
     VALUES (:event_id, :application_id, :user_id, :job_id, :event_type, :event_source,
             CAST(:event_at AS TIMESTAMPTZ), :note, CAST(:metadata_json AS JSONB))`,
    [
      { name: 'event_id', value: randomUUID() },
      { name: 'application_id', value: applicationId(userId, jobId) },
      { name: 'user_id', value: userId },
      { name: 'job_id', value: jobId },
      { name: 'event_type', value: status },
      { name: 'event_source', value: source },
      { name: 'event_at', value: at },
      { name: 'note', value: note },
      { name: 'metadata_json', value: JSON.stringify({ previous_status: previous }) },
    ],
  );

  return { ok: true, job_id: jobId, status, previous_status: previous, at };
}

function wholeDaysSince(value: string | null): number | null {
  if (!value) return null;
  const then = Date.parse(value);
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

/** The latest stage for one job, or null when it is not on the board. */
export async function currentStage(sql: SqlFn, userId: string, jobId: string): Promise<PipelineStatus | null> {
  const result = await sql(
    'SELECT current_state FROM latest_application_state WHERE user_id = :user_id AND job_id = :job_id',
    [
      { name: 'user_id', value: userId },
      { name: 'job_id', value: jobId },
    ],
  );
  return toStage(objects(result)[0]?.current_state);
}

/** The whole board for one user, newest stage change first. */
export async function readBoard(
  sql: SqlFn,
  userId: string,
  matches?: Map<string, { score: number | null; reason: string | null }>,
): Promise<PipelineBoard> {
  const result = await sql(
    `SELECT s.job_id, s.current_state, s.note, s.events_total,
            s.state_changed_at, s.first_seen_at,
            j.job_title, j.company_name, j.location_text, j.source_url
       FROM latest_application_state s
       LEFT JOIN job_snapshots j ON j.job_id = s.job_id
      WHERE s.user_id = :user_id
      ORDER BY s.state_changed_at DESC, s.event_id DESC`,
    [{ name: 'user_id', value: userId }],
  );

  const board = emptyBoard();
  for (const row of objects(result)) {
    const status = toStage(row.current_state);
    if (!status || !row.job_id) continue;
    const match = matches?.get(row.job_id);
    board.stages[status].push({
      job_id: row.job_id,
      status,
      title: row.job_title,
      company: row.company_name,
      location: row.location_text,
      source_url: row.source_url,
      status_changed_at: row.state_changed_at,
      days_in_stage: wholeDaysSince(row.state_changed_at),
      days_tracked: wholeDaysSince(row.first_seen_at),
      events_total: Number(row.events_total ?? '1'),
      note: row.note,
      match_score: match?.score ?? null,
      match_reason: match?.reason ?? null,
    });
    board.counts[status] += 1;
    board.total += 1;
  }
  return board;
}

export type PipelineEvent = {
  event_id: string;
  event_type: string;
  event_source: string | null;
  at: string;
  note: string | null;
};

/** Every event for one job, newest first, including activity that is not a stage. */
export async function readHistory(sql: SqlFn, userId: string, jobId: string): Promise<PipelineEvent[]> {
  const result = await sql(
    `SELECT event_id, event_type, event_source, note, event_at AS at
       FROM application_events
      WHERE user_id = :user_id AND job_id = :job_id
      ORDER BY event_at DESC, event_id DESC`,
    [
      { name: 'user_id', value: userId },
      { name: 'job_id', value: jobId },
    ],
  );
  return objects(result).map((row) => ({
    event_id: row.event_id ?? '',
    event_type: row.event_type ?? '',
    event_source: row.event_source,
    at: row.at ?? '',
    note: row.note,
  }));
}

/**
 * Fit and reason per job from the applicant's current matches. Never throws:
 * the board is useful without scores.
 */
export async function readMatchMap(
  sql: SqlFn,
  userId: string,
): Promise<Map<string, { score: number | null; reason: string | null }>> {
  const map = new Map<string, { score: number | null; reason: string | null }>();
  try {
    const result = await sql(
      `SELECT m.job_id, m.score, m.reason
         FROM latest_resume l JOIN job_matches m USING (document_id)
        WHERE l.user_id = :user_id`,
      [{ name: 'user_id', value: userId }],
    );
    for (const row of objects(result)) {
      if (!row.job_id) continue;
      const score = row.score === null ? null : Math.round(Number(row.score) * 100);
      map.set(row.job_id, {
        score: Number.isFinite(score) ? score : null,
        reason: row.reason?.trim() ? row.reason : null,
      });
    }
  } catch (error) {
    console.warn('[pipeline] match scores unavailable:', (error as Error).message);
  }
  return map;
}
