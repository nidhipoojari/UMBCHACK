'use client';

/**
 * ONE CONVERSATION with the agent, however it happens.
 *
 * The chat drawer (typed) and the floating face (spoken) are two ways into the
 * same conversation, so they share one transcript, held here in the workspace
 * shell where both live. Spoken turns are marked `via: 'voice'`; whatever the
 * agent looked up along the way is recorded as an action line, so the drawer
 * shows the whole exchange, not just the words.
 *
 * The agent sees all of it: a question asked out loud can be followed up in
 * writing and the other way round, because both send this same history.
 *
 * It lasts for the browser tab: it survives moving between workspace pages (the
 * shell stays mounted) and a reload (sessionStorage), and starts fresh in a new
 * tab. Kept per user, so switching accounts in one tab never shows the last
 * person's conversation.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { authedFetch } from '@/lib/authed-fetch';

import type { ActionKind, ChatEntry } from './TranscriptAction';

export type Turn = { role: 'user' | 'agent'; text: string };

type ToolCall = { name: string; result?: Record<string, unknown> };

export type Conversation = {
  entries: ChatEntry[];
  /** A typed message is waiting on the agent. */
  busy: boolean;
  /** Send a typed message and add the agent's answer when it lands. */
  send: (text: string) => Promise<void>;
  /** Record a spoken turn from the voice agent. */
  recordVoice: (role: Turn['role'], text: string, extra?: { toolCalls?: ToolCall[]; end?: boolean }) => void;
  /** The conversation so far, as the agent API takes it. Read at call time, never stale. */
  history: () => Turn[];
};

const ConversationContext = createContext<Conversation | null>(null);

export function useConversation(): Conversation | null {
  return useContext(ConversationContext);
}

/** How much of the conversation is kept, and how much is sent to the agent per turn. */
const KEEP = 80;
const SEND = 12;

let counter = 0;
const id = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

/** What a tool call looks like as a line in the transcript. */
function actionFor(call: ToolCall): { kind: ActionKind; text: string } | null {
  const r = call.result ?? {};
  switch (call.name) {
    case 'my_job_matches': {
      const n = Array.isArray(r.matches) ? r.matches.length : 0;
      return { kind: 'job_matched', text: n ? `Checked your top ${n} ${n === 1 ? 'match' : 'matches'}.` : 'Checked your matches.' };
    }
    case 'my_pipeline':
      return { kind: 'looked_up', text: `Checked your pipeline${typeof r.total === 'number' ? ` (${r.total} ${r.total === 1 ? 'job' : 'jobs'})` : ''}.` };
    case 'my_profile':
      return { kind: 'looked_up', text: 'Read your profile.' };
    case 'my_coursework':
      return { kind: 'looked_up', text: 'Read your coursework (synthetic stand-in).' };
    case 'career_pathways':
    case 'degree_roi':
    case 'skill_gap':
      return { kind: 'looked_up', text: 'Looked up career data (sample numbers for now).' };
    default:
      return null;
  }
}

function load(key: string): ChatEntry[] {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? '[]') as ChatEntry[];
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

export function ConversationProvider({
  userId,
  pageName,
  children,
}: {
  userId: string;
  pageName: string | null;
  children: React.ReactNode;
}) {
  const storageKey = `agenthire:transcript:${userId}`;
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [busy, setBusy] = useState(false);
  // The source of truth for history(), updated synchronously so a voice turn
  // recorded a moment ago is already in the next request.
  const list = useRef<ChatEntry[]>([]);
  const page = useRef(pageName);
  useEffect(() => {
    page.current = pageName;
  }, [pageName]);

  useEffect(() => {
    list.current = load(storageKey);
    setEntries(list.current);
  }, [storageKey]);

  const add = useCallback(
    (...items: ChatEntry[]) => {
      list.current = [...list.current, ...items].slice(-KEEP);
      setEntries(list.current);
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(list.current));
      } catch {
        /* storage full or blocked: the conversation still works, it just won't survive a reload */
      }
    },
    [storageKey],
  );

  const history = useCallback(
    (): Turn[] =>
      list.current
        .flatMap((e) => (e.role === 'user' || e.role === 'agent' ? [{ role: e.role, text: e.text }] : []))
        .slice(-SEND),
    [],
  );

  const actions = useCallback((calls: ToolCall[] = [], end = false): ChatEntry[] => {
    const lines: ChatEntry[] = calls.flatMap((call) => {
      const action = actionFor(call);
      return action ? [{ id: id('x'), role: 'action' as const, state: 'done' as const, ...action }] : [];
    });
    if (end) lines.push({ id: id('x'), role: 'action', kind: 'ended', state: 'done', text: 'Conversation closed.' });
    return lines;
  }, []);

  const recordVoice = useCallback<Conversation['recordVoice']>(
    (role, text, extra) => {
      const spoken: ChatEntry = { id: id(role === 'user' ? 'u' : 'a'), role, text, via: 'voice' };
      add(...actions(extra?.toolCalls), spoken, ...(extra?.end ? actions([], true) : []));
    },
    [actions, add],
  );

  const send = useCallback(
    async (text: string) => {
      add({ id: id('u'), role: 'user', text, via: 'text' });
      setBusy(true);
      try {
        const res = await authedFetch('/api/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history(), page: page.current }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          reply?: string;
          error?: string;
          toolCalls?: ToolCall[];
          end?: boolean;
        };
        const reply = data.reply ?? data.error ?? 'Sorry, I could not answer that just now.';
        add(...actions(data.toolCalls), { id: id('a'), role: 'agent', text: reply, via: 'text' }, ...(data.end ? actions([], true) : []));
      } catch {
        add({ id: id('a'), role: 'agent', text: 'Sorry, I could not reach the agent. Check your connection and try again.', via: 'text' });
      } finally {
        setBusy(false);
      }
    },
    [actions, add, history],
  );

  const value = useMemo<Conversation>(() => ({ entries, busy, send, recordVoice, history }), [entries, busy, send, recordVoice, history]);
  return <ConversationContext.Provider value={value}>{children}</ConversationContext.Provider>;
}
