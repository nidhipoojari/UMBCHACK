/**
 * An ACTION line in the chat: what the agent did, rendered by kind. The `never` in the switch means adding a kind without a case here
 * fails the type check.
 */
import { BadgeCheck, Ban, BriefcaseBusiness, ListChecks, MicOff, Navigation, Search, UserCheck } from 'lucide-react';

export type ActionKind =
  | 'profile_updated'
  | 'job_matched'
  | 'refused'
  | 'navigated'
  | 'job_status_set'
  | 'looked_up'
  | 'ended';

export type ChatEntry =
  /** `via` marks how a turn happened: typed in the drawer, or spoken to the floating agent. */
  | { id: string; role: 'agent' | 'user'; text: string; via?: 'text' | 'voice' }
  | { id: string; role: 'action'; kind: ActionKind; state: 'pending' | 'done' | 'failed'; text: string };

type ActionEntry = Extract<ChatEntry, { role: 'action' }>;

const LABELS: Record<ActionKind, string> = {
  profile_updated: 'PROFILE UPDATED',
  job_matched: 'MATCHES',
  refused: 'REFUSED',
  navigated: 'OPENED',
  job_status_set: 'STAGE CHANGED',
  looked_up: 'CHECKED',
  ended: 'ENDED',
};

function icon(kind: ActionKind) {
  switch (kind) {
    case 'profile_updated':
      return <UserCheck size={15} aria-hidden="true" />;
    case 'job_matched':
      return <BriefcaseBusiness size={15} aria-hidden="true" />;
    case 'refused':
      return <Ban size={15} aria-hidden="true" />;
    case 'navigated':
      return <Navigation size={15} aria-hidden="true" />;
    case 'job_status_set':
      return <ListChecks size={15} aria-hidden="true" />;
    case 'looked_up':
      return <Search size={15} aria-hidden="true" />;
    case 'ended':
      return <MicOff size={15} aria-hidden="true" />;
    default: {
      const unhandled: never = kind;
      return unhandled;
    }
  }
}

export function TranscriptAction({ entry }: { entry: ActionEntry }) {
  return (
    <li className={`vt-entry vt-action is-${entry.state}`}>
      <span className="vt-action-tag">
        {/* A settled refusal keeps the refusal icon; a tick beside "I would not
            open that" would read as success. */}
        {entry.state === 'done' && entry.kind !== 'refused' && entry.kind !== 'ended' ? (
          <BadgeCheck size={15} aria-hidden="true" />
        ) : (
          icon(entry.kind)
        )}
        {LABELS[entry.kind]}
        {entry.state === 'pending' ? ' · SAVING' : null}
        {entry.state === 'failed' ? ' · FAILED' : null}
      </span>
      <span className="vt-action-text">{entry.text}</span>
    </li>
  );
}
