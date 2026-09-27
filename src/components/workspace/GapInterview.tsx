'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { authedFetch } from '@/lib/authed-fetch';

import type { FaceMood } from '../AgentFace';
import { AgentFaceLive } from '../AgentFaceLive';
import { MicBlockedError, useVoiceIO } from '../useVoiceIO';

/**
 * "Close the gaps": the skills your matched roles keep asking for that your
 * resume does not show, asked out loud, then your matches re-checked.
 *
 * THE SAME AGENT AS THE LANDING PAGE. The 3D face is the button (tap to start,
 * tap again to stop), the line it is saying sits under it in the same caption
 * card, and the hint below says what a tap will do. The conversation so far is
 * kept as a transcript in those same cards: the agent's lines with its prompt
 * mark, yours in the muted "you" style. Classes are shared with the greeter
 * (globals.css), so the two can never drift apart.
 *
 * Voice first, with a typed path beside it: the same questions and the same
 * endpoint, for a loud hall, a blocked mic, or anyone who would rather type.
 * Stopping a voice interview part-way drops into the typed form with whatever
 * was already heard filled in, so nothing said is lost.
 *
 * When the rerank lands, `agenthire:matches-changed` tells the match list on
 * the page to reload, and this panel shows what it heard and what moved.
 */

type Gap = { key: string; skill: string; roles: number; examples: string[] };
type Question = { key: string; skill: string; question: string };
type Finding = { key: string; skill: string; verdict: 'has' | 'some' | 'none' | 'unclear'; evidence: string | null; said: string };
type Role = { job_id: string; title: string | null; company: string | null; rank: number; score: number };
type Result = { findings: Finding[]; before: Role[]; after: Role[]; summary: string };
type Line = { who: 'agent' | 'you' | 'note'; text: string };

type View = 'idle' | 'starting' | 'asking' | 'analysing' | 'done';

export const MATCHES_CHANGED = 'agenthire:matches-changed';

const VERDICT: Record<Finding['verdict'], string> = {
  has: 'Used it',
  some: 'Some exposure',
  none: 'Not yet',
  unclear: 'Not clear',
};

const roleName = (r: Role) => [r.title, r.company].filter(Boolean).join(' · ') || 'Untitled role';

const listOf = (items: string[]) =>
  items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : (items[0] ?? '');

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    return ((await res.json()) as { error?: string }).error ?? fallback;
  } catch {
    return fallback;
  }
}

export function GapInterview() {
  const io = useVoiceIO();
  const [gaps, setGaps] = useState<Gap[] | null>(null);
  const [matchCount, setMatchCount] = useState(0);
  const [view, setView] = useState<View>('idle');
  const [mode, setMode] = useState<'voice' | 'form'>('voice');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [heard, setHeard] = useState<Set<string>>(new Set());
  const [caption, setCaption] = useState<Line | null>(null);
  const [transcript, setTranscript] = useState<Line[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const stopped = useRef(false);

  /** The agent says something: it becomes the live caption and joins the transcript. */
  const agentLine = useCallback((text: string, keep = true) => {
    setCaption({ who: 'agent', text });
    if (keep) setTranscript((t) => [...t, { who: 'agent', text }]);
  }, []);

  const youLine = useCallback((text: string) => {
    setCaption({ who: 'you', text });
    setTranscript((t) => [...t, { who: 'you', text }]);
  }, []);

  const loadGaps = useCallback(async () => {
    try {
      const res = await authedFetch('/api/gaps');
      if (!res.ok) return false;
      const data = (await res.json()) as { matchCount: number; gaps: Gap[] };
      setMatchCount(data.matchCount);
      setGaps(data.gaps);
      return data.matchCount > 0;
    } catch {
      return false;
    }
  }, []);

  // Matches may still be running when the page opens: look again every few
  // seconds until there are some to compare against.
  useEffect(() => {
    let timer: number | undefined;
    let tries = 0;
    const tick = async () => {
      const ready = await loadGaps();
      if (!ready && ++tries < 60) timer = window.setTimeout(tick, 5000);
    };
    void tick();
    return () => window.clearTimeout(timer);
  }, [loadGaps]);

  const begin = useCallback(async (): Promise<{ questions: Question[]; intro: string } | null> => {
    const res = await authedFetch('/api/gaps', { method: 'POST' });
    if (!res.ok) {
      setNote(await readError(res, 'Could not start the interview.'));
      return null;
    }
    const data = (await res.json()) as { questions: Question[]; intro: string };
    setQuestions(data.questions);
    setAnswers({});
    setHeard(new Set());
    setCurrent(0);
    setResult(null);
    setTranscript([]);
    return data;
  }, []);

  const submit = useCallback(
    async (qs: Question[], given: Record<string, string>, spoken: Set<string>) => {
      setView('analysing');
      agentLine('Re-reading your matches with what you told me…', false);
      io.busy();
      try {
        const res = await authedFetch('/api/gaps/answers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answers: qs.map((q) => ({
              key: q.key,
              skill: q.skill,
              text: given[q.key] ?? '',
              source: spoken.has(q.key) ? 'voice' : 'form',
            })),
          }),
        });
        if (!res.ok) throw new Error(await readError(res, 'Could not re-check your matches.'));
        const data = (await res.json()) as Result;
        setResult(data);
        setView('done');
        agentLine(data.summary);
        window.dispatchEvent(new Event(MATCHES_CHANGED));
        void loadGaps();
        if (io.live.current) await io.say(data.summary);
      } catch (error) {
        setNote(error instanceof Error ? error.message : 'Could not re-check your matches.');
        setView('asking');
        setMode('form');
      } finally {
        io.close();
      }
    },
    [agentLine, io, loadGaps],
  );

  /** The spoken interview. Runs start to finish unless stopped. */
  const startVoice = useCallback(async () => {
    io.open(); // inside the click, so the browser lets it speak
    stopped.current = false;
    setNote(null);
    setMode('voice');
    setView('starting');
    const started = await begin();
    if (!started || stopped.current) {
      io.close();
      setView('idle');
      return;
    }
    setView('asking');
    const given: Record<string, string> = {};
    const spoken = new Set<string>();

    try {
      agentLine(started.intro);
      await io.say(started.intro);
      for (const [i, q] of started.questions.entries()) {
        if (stopped.current) return;
        setCurrent(i);
        agentLine(q.question);
        await io.say(q.question);
        let text = await io.hear();
        if (!text && !stopped.current) {
          const again = "Sorry, I didn't catch that. Could you say it again?";
          agentLine(again);
          await io.say(again);
          text = await io.hear();
        }
        if (stopped.current) return;
        given[q.key] = text ?? '';
        if (text) {
          spoken.add(q.key);
          youLine(text);
        } else {
          setTranscript((t) => [...t, { who: 'note', text: `Skipped ${q.skill}` }]);
        }
        setAnswers({ ...given });
        setHeard(new Set(spoken));
      }
    } catch (error) {
      io.close();
      setMode('form');
      setAnswers({ ...given });
      setNote(
        error instanceof MicBlockedError
          ? 'Your microphone is blocked, so type your answers instead. You can allow it from the address bar.'
          : 'Voice stopped working, so type the rest instead.',
      );
      return;
    }
    if (!stopped.current) await submit(started.questions, given, spoken);
  }, [agentLine, begin, io, submit, youLine]);

  const startTyped = useCallback(async () => {
    setNote(null);
    setMode('form');
    setView('starting');
    const started = await begin();
    setView(started ? 'asking' : 'idle');
    if (started) agentLine(started.intro, false);
  }, [agentLine, begin]);

  /** Stop talking: keep what was heard and finish by typing. */
  const stopVoice = useCallback(() => {
    stopped.current = true;
    io.close();
    setMode('form');
    agentLine('Stopped. Finish by typing, or leave any answer blank to skip it.', false);
  }, [agentLine, io]);

  if (!gaps || !matchCount) return null;
  if (!gaps.length && view !== 'done') return null;

  const talking = mode === 'voice' && (view === 'starting' || view === 'asking') && io.phase !== 'off';

  // The face, exactly as on the landing page: it is the button.
  const mood: FaceMood =
    io.phase !== 'off' ? io.mood : view === 'analysing' || view === 'starting' ? 'thinking' : view === 'done' ? 'happy' : 'idle';

  const faceEnabled = view === 'idle' || talking || view === 'done';
  const onFace = () => {
    if (view === 'idle') void startVoice();
    else if (talking) stopVoice();
    else if (view === 'done') setView('idle');
  };

  const faceLabel =
    view === 'idle' ? 'Talk to agentHire about your gaps' : talking ? 'Stop talking and type instead' : 'agentHire';

  const idleLine = `Your roles keep asking for ${listOf(gaps.map((g) => g.skill))}. Tap me and I'll ask you about ${
    gaps.length === 1 ? 'it' : 'them'
  }, then re-check your matches.`;

  const shown: Line = view === 'idle' ? { who: 'agent', text: idleLine } : (caption ?? { who: 'agent', text: '…' });

  const hint =
    view === 'idle'
      ? 'Tap the face to talk'
      : view === 'starting'
        ? 'Working out what to ask…'
        : view === 'analysing'
          ? 'Re-checking your matches…'
          : view === 'done'
            ? 'Done · tap to close'
            : mode === 'form'
              ? 'Type your answers below'
              : io.phase === 'listening'
                ? `Listening · question ${current + 1} of ${questions.length} · tap to stop`
                : `Speaking · question ${current + 1} of ${questions.length} · tap to stop`;

  return (
    <section className="ws-section gi" aria-labelledby="gi-h">
      <header>
        <h2 id="gi-h">Close the gaps</h2>
        {view === 'idle' ? (
          <span className="muted">
            {gaps.length} {gaps.length === 1 ? 'question' : 'questions'}, about a minute
          </span>
        ) : null}
      </header>

      <div className="greeter gi__greeter">
        <button
          type="button"
          className={['greeter__face', io.phase === 'listening' ? 'is-listening' : '', io.phase === 'speaking' ? 'is-speaking' : '']
            .filter(Boolean)
            .join(' ')}
          onClick={onFace}
          disabled={!faceEnabled}
          aria-label={faceLabel}
          aria-pressed={talking}
        >
          <AgentFaceLive mood={mood} size={200} />
        </button>

        <p className={`greeter__caption is-live${shown.who === 'you' ? ' is-you' : ''}`} aria-live="polite">
          {shown.who === 'you' ? `You: ${shown.text}` : shown.text}
        </p>

        <p className="greeter__hint" aria-hidden="true">
          {hint}
        </p>
      </div>

      {view === 'idle' ? (
        <>
          <ul className="gi__gaps">
            {gaps.map((g) => (
              <li key={g.key}>
                <strong>{g.skill}</strong>
                <span className="muted">
                  {g.roles} of {matchCount} roles{g.examples[0] ? `, like ${g.examples[0]}` : ''}
                </span>
              </li>
            ))}
          </ul>
          <div className="ws-actions gi__actions">
            <button type="button" className="primary" onClick={() => void startVoice()}>
              Talk it through
            </button>
            <button type="button" className="secondary" onClick={() => void startTyped()}>
              Type instead
            </button>
          </div>
        </>
      ) : null}

      {mode === 'voice' && transcript.length > 1 && view !== 'idle' ? (
        <ol className="gi__transcript" aria-label="Conversation so far">
          {transcript.slice(0, -1).map((l, i) => (
            <li
              key={i}
              className={l.who === 'note' ? 'gi__note' : `greeter__caption is-live${l.who === 'you' ? ' is-you' : ''}`}
            >
              {l.who === 'you' ? `You: ${l.text}` : l.text}
            </li>
          ))}
        </ol>
      ) : null}

      {mode === 'form' && (view === 'asking' || view === 'analysing') ? (
        <form
          className="gi__form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(questions, answers, heard);
          }}
        >
          {questions.map((q) => (
            <div className="field" key={q.key}>
              <label htmlFor={`gi-${q.key}`}>{q.skill}</label>
              <p className="gi__q">{q.question}</p>
              <textarea
                id={`gi-${q.key}`}
                rows={2}
                value={answers[q.key] ?? ''}
                placeholder="e.g. I used it in a class project to…"
                onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))}
                disabled={view === 'analysing'}
              />
            </div>
          ))}
          <div className="ws-actions">
            <button type="submit" className="primary" disabled={view === 'analysing'}>
              {view === 'analysing' ? 'Re-checking…' : 'Update my matches'}
            </button>
          </div>
        </form>
      ) : null}

      {talking ? (
        <div className="ws-actions gi__actions">
          <button type="button" className="secondary" onClick={stopVoice}>
            Stop and type instead
          </button>
        </div>
      ) : null}

      {view === 'done' && result ? <Outcome result={result} onClose={() => setView('idle')} /> : null}

      {note ? (
        <p className="auth-error" role="alert">
          {note}
        </p>
      ) : null}
    </section>
  );
}

/** What was heard, then what moved. Arrows are paired with words, never colour alone. */
function Outcome({ result, onClose }: { result: Result; onClose: () => void }) {
  const was = new Map(result.before.map((r) => [r.job_id, r.rank]));
  const moved = result.after
    .map((r) => ({ role: r, delta: (was.get(r.job_id) ?? r.rank) - r.rank }))
    .filter((m) => m.delta !== 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 5);

  return (
    <div className="gi__outcome">
      <h3>What I noted</h3>
      <ul className="ws-list">
        {result.findings.map((f) => (
          <li className="ws-row" key={f.key}>
            <div>
              <h3>{f.skill}</h3>
              <p>{f.evidence ?? (f.said ? `“${f.said}”` : 'Skipped')}</p>
            </div>
            <span className="ws-pill">{f.said ? VERDICT[f.verdict] : 'Skipped'}</span>
          </li>
        ))}
      </ul>

      <h3>What moved</h3>
      {moved.length ? (
        <ul className="ws-list">
          {moved.map(({ role, delta }) => (
            <li className="ws-row" key={role.job_id}>
              <div>
                <h3>{roleName(role)}</h3>
                <p>
                  {delta > 0 ? `Up ${delta}` : `Down ${-delta}`}: now #{role.rank} (was #{was.get(role.job_id)})
                </p>
              </div>
              <strong aria-hidden="true">{delta > 0 ? '↑' : '↓'}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nothing moved: your top roles already fit best.</p>
      )}
      <p className="muted gi__small">
        Your answers are kept with your profile but never added to your resume or to anything we write for you.
      </p>
      <div className="ws-actions">
        <button type="button" className="secondary" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
