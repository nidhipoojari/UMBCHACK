/**
 * The pipeline's stages and card shape. No runtime imports, so the board and
 * the save button (client components) can use it as well as the server.
 */

/** Every stage a job can be in, in the order the board lists them. */
export const PIPELINE_STATUSES = [
  'saved',
  'applied',
  'interviewing',
  'offer',
  'accepted',
  'rejected',
  'withdrawn',
] as const;

export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

/** The funnel proper. Rejected and withdrawn are exits, not steps. */
export const FUNNEL_STAGES = ['saved', 'applied', 'interviewing', 'offer', 'accepted'] as const;

export const PIPELINE_SOURCES = ['ui', 'voice'] as const;
export type PipelineSource = (typeof PIPELINE_SOURCES)[number];

/**
 * Other event types that imply a stage: an application sent for you counts as
 * applied, and an employer reply as interviewing. Activity such as "viewed"
 * is deliberately absent, so it can never move a job backwards.
 */
export const IMPLIED_STAGE: Record<string, PipelineStatus> = {
  submitted: 'applied',
  callback: 'interviewing',
};

export const STATUS_LABEL: Record<PipelineStatus, string> = {
  saved: 'Saved',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  accepted: 'Accepted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

/** Offer is the employer's decision and accepted is yours, so they are two stages. */
export const STATUS_HINT: Record<PipelineStatus, string> = {
  saved: 'Worth a look. Nothing sent yet.',
  applied: 'Application sent. Waiting on them.',
  interviewing: 'They replied and the conversation is live.',
  offer: 'They made an offer. Their decision.',
  accepted: 'You said yes. Your decision.',
  rejected: 'They said no.',
  withdrawn: 'You pulled out.',
};

/** A mark per stage so a badge never relies on colour alone. */
export const STATUS_MARK: Record<PipelineStatus, string> = {
  saved: '1',
  applied: '2',
  interviewing: '3',
  offer: '4',
  accepted: '5',
  rejected: '×',
  withdrawn: '×',
};

export function isPipelineStatus(value: unknown): value is PipelineStatus {
  return typeof value === 'string' && (PIPELINE_STATUSES as readonly string[]).includes(value);
}

export function isPipelineSource(value: unknown): value is PipelineSource {
  return typeof value === 'string' && (PIPELINE_SOURCES as readonly string[]).includes(value);
}

/** A raw event type as a stage, or null when it is activity rather than a stage. */
export function toStage(eventType: string | null | undefined): PipelineStatus | null {
  if (!eventType) return null;
  if (isPipelineStatus(eventType)) return eventType;
  return IMPLIED_STAGE[eventType] ?? null;
}

export type PipelineCard = {
  job_id: string;
  status: PipelineStatus;
  title: string | null;
  company: string | null;
  location: string | null;
  source_url: string | null;
  /** When the current stage was entered, ISO 8601. */
  status_changed_at: string | null;
  /** Whole days in the current stage; 0 is today. */
  days_in_stage: number | null;
  /** Whole days since the job first entered the pipeline. */
  days_tracked: number | null;
  /** Events logged for this job. */
  events_total: number;
  note: string | null;
  /** Fit out of 100 when this job is one of your matches. */
  match_score: number | null;
  match_reason: string | null;
};

export type PipelineBoard = {
  stages: Record<PipelineStatus, PipelineCard[]>;
  counts: Record<PipelineStatus, number>;
  total: number;
};

export function emptyBoard(): PipelineBoard {
  return {
    stages: { saved: [], applied: [], interviewing: [], offer: [], accepted: [], rejected: [], withdrawn: [] },
    counts: { saved: 0, applied: 0, interviewing: 0, offer: 0, accepted: 0, rejected: 0, withdrawn: 0 },
    total: 0,
  };
}

/**
 * "7 days in Applied, no response yet." Null when there is nothing worth
 * saying; under three days is not stalled.
 */
export function stalledSentence(card: PipelineCard): string | null {
  const days = card.days_in_stage;
  if (days === null || days < 3) return null;
  if (card.status === 'applied') return `${days} days in Applied, no response yet.`;
  if (card.status === 'interviewing') return `${days} days since the last interview update.`;
  if (card.status === 'offer') return `${days} days to decide on this offer.`;
  return null;
}

/** "today" / "1 day" / "12 days", for use inside a sentence. */
export function daysPhrase(days: number | null): string {
  if (days === null) return 'an unknown time';
  if (days === 0) return 'today';
  if (days === 1) return '1 day';
  return `${days} days`;
}
