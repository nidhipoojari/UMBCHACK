'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { authedFetch } from '@/lib/authed-fetch';
import {
  QUESTION_KIND_LABEL,
  QUESTION_SOURCE_LABEL,
  takePreparedSession,
  type AnswerCritique,
  type InterviewAnswer,
  type InterviewFeedback,
  type InterviewQuestion,
  type InterviewSessionPayload,
} from '@/lib/interview-contract';

import { PixelWave, useLiveInterviewer } from './LiveInterviewer';
import './interview.css';

type Phase = 'brief' | 'live' | 'done';

/** How long a finished answer waits before it sends, so the candidate can keep going. */
const GRACE_MS = 2500;

/**
 * The mock interview room: a live, two-way voice call with a Gemini
 * interviewer, with the candidate's camera on as a self-view. The interviewer
 * asks each question out loud; when the candidate stops talking, what they said
 * is shown and sent after a short grace period, and the next question follows.
 * Speaking again or "Wait, I'm not done" holds it. The critique of each answer
 * builds up underneath, and the readout comes at the end.
 */
export function InterviewRoom({ jobId }: { jobId: string }) {
  const [session, setSession] = useState<InterviewSessionPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('brief');
  const [index, setIndex] = useState(0);

  const [said, setSaidState] = useState('');
  const [answers, setAnswers] = useState<InterviewAnswer[]>([]);
  const [critiques, setCritiques] = useState<AnswerCritique[]>([]);
  const [feedback, setFeedback] = useState<InterviewFeedback | null>(null);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** When a finished answer sends by itself (Date.now()), or null. */
  const [autoSendAt, setAutoSendAt] = useState<number | null>(null);
  const [clock, setClock] = useState(0);

  // What the candidate said is read from timers and socket callbacks, so it lives in a ref too.
  const saidRef = useRef('');
  const setSaid = useCallback((value: string) => {
    saidRef.current = value;
    setSaidState(value);
  }, []);
  const scheduledAtRef = useRef(0);

  const scheduleAutoSend = useCallback(() => {
    if (!saidRef.current.trim()) return;
    scheduledAtRef.current = performance.now();
    setAutoSendAt(Date.now() + GRACE_MS);
    setClock(Date.now());
    setNotice('Got it. Your answer sends in a moment; keep talking to add more.');
  }, []);

  const onHeard = useCallback(
    (text: string, finished: boolean) => {
      if (text) {
        setSaid((saidRef.current + text).replace(/^\s+/, ''));
        // Still talking: whatever was about to send waits for the end of this.
        if (!finished) setAutoSendAt(null);
      }
      if (finished) scheduleAutoSend();
    },
    [scheduleAutoSend, setSaid],
  );
  const liveCall = useLiveInterviewer(jobId, session?.sessionId ?? '', { onHeard, onNotice: setNotice });
  const liveOn = liveCall.status === 'live' || liveCall.status === 'connecting';

  const preparedRef = useRef<InterviewSessionPayload | null | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const sendRef = useRef<(skip: boolean) => Promise<void>>(async () => {});

  /* ------------------------------------------------------------- the session */

  useEffect(() => {
    let cancelled = false;
    // The pipeline may have fetched this session before navigating here. Taken
    // once into a ref, so a remount in development does not lose it.
    if (preparedRef.current === undefined) preparedRef.current = takePreparedSession(jobId);

    (async () => {
      const prepared = preparedRef.current;
      if (prepared) {
        if (!cancelled) setSession(prepared);
        return;
      }
      try {
        const response = await authedFetch(`/api/interview/${encodeURIComponent(jobId)}/session`);
        const payload = (await response.json()) as InterviewSessionPayload & { error?: string };
        if (cancelled) return;
        if (!response.ok) {
          setLoadError(payload.error ?? `The interview room could not be prepared (${response.status}).`);
          return;
        }
        preparedRef.current = payload;
        setSession(payload);
      } catch (error) {
        if (!cancelled) setLoadError((error as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  /* ---------------------------------------------------------------- the camera */

  const stopCamera = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  /** Opens the camera into the self-view. Resolves to an error sentence, or null when it is on. */
  const openCamera = useCallback(async (): Promise<string | null> => {
    if (cameraStreamRef.current) return null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      return null;
    } catch (error) {
      const name = (error as DOMException).name;
      return name === 'NotAllowedError'
        ? 'The browser blocked the camera. Allow it in the address bar to see yourself while you answer.'
        : `The camera could not start (${name || 'unknown error'}).`;
    }
  }, []);
  const startCamera = useCallback(() => {
    void openCamera().then(setCameraError);
  }, [openCamera]);

  // The camera comes on as soon as the room is ready, and goes off when the
  // interview is over, on unmount, and while the tab is hidden.
  const cameraWanted = !!session && !session.locked && phase !== 'done';
  useEffect(() => {
    if (!cameraWanted) {
      stopCamera();
      return;
    }
    void openCamera().then(setCameraError);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stopCamera();
      else void openCamera().then(setCameraError);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stopCamera();
    };
  }, [cameraWanted, openCamera, stopCamera]);

  /* ------------------------------------------------------------- the answers */

  const question: InterviewQuestion | null = session?.questions[index] ?? null;

  const finish = useCallback(
    async (allAnswers: InterviewAnswer[]) => {
      if (!session) return;
      setBusy('Writing your readout.');
      try {
        const response = await authedFetch(`/api/interview/${encodeURIComponent(jobId)}/finish`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: session.sessionId, answers: allAnswers }),
        });
        const payload = (await response.json()) as { feedback?: InterviewFeedback; error?: string };
        if (!response.ok || !payload.feedback) {
          setNotice(payload.error ?? `The readout could not be written (${response.status}).`);
          return;
        }
        setFeedback(payload.feedback);
        setPhase('done');
      } catch (error) {
        setNotice((error as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [jobId, session],
  );

  const send = useCallback(
    async (skip: boolean) => {
      if (!session || !question) return;
      setAutoSendAt(null);
      const text = skip ? '' : saidRef.current.trim();
      if (!skip && !text) {
        setNotice('Nothing heard yet. Answer out loud and it appears here.');
        return;
      }

      setBusy(skip ? 'Skipping.' : 'Sending your answer.');
      const seconds = liveCall.takeSpeechSeconds();
      const answer: InterviewAnswer = {
        questionId: question.id,
        text,
        source: 'spoken',
        spokenSeconds: skip || seconds <= 0 ? null : seconds,
      };

      try {
        const response = await authedFetch(`/api/interview/${encodeURIComponent(jobId)}/turn`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionId: session.sessionId,
            questionId: question.id,
            text,
            source: answer.source,
            spokenSeconds: answer.spokenSeconds ?? undefined,
          }),
        });
        const payload = (await response.json()) as { critique?: AnswerCritique; error?: string };
        if (!response.ok || !payload.critique) {
          setNotice(payload.error ?? `That answer did not send (${response.status}).`);
          return;
        }
        const allAnswers = [...answers, answer];
        setAnswers(allAnswers);
        setCritiques((previous) => [...previous, payload.critique as AnswerCritique]);
        setSaid('');
        setNotice(null);
        setIndex((previous) => previous + 1);
        const last = index + 1 >= session.questions.length;
        // The room owns the order: the interviewer is told what comes next.
        if (liveCall.status === 'live') {
          if (last) liveCall.end();
          else liveCall.ask(index + 1);
        }
        if (last) await finish(allAnswers);
      } catch (error) {
        setNotice((error as Error).message);
      } finally {
        setBusy((current) => (current === 'Writing your readout.' ? current : null));
      }
    },
    [answers, finish, index, jobId, liveCall, question, session, setSaid],
  );

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // A finished answer sends itself after the grace period, unless the candidate
  // started talking again in the meantime. Only stable values are dependencies,
  // so the countdown's own re-renders do not restart the timer.
  const lastVoiceAt = liveCall.lastVoiceAt;
  useEffect(() => {
    if (autoSendAt === null) return;
    const tick = window.setInterval(() => setClock(Date.now()), 250);
    const fire = window.setTimeout(
      () => {
        const voice = lastVoiceAt();
        if (voice !== null && voice > scheduledAtRef.current + 300) {
          setAutoSendAt(null);
          setNotice('Still listening.');
          return;
        }
        void sendRef.current(false);
      },
      Math.max(0, autoSendAt - Date.now()),
    );
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(fire);
    };
  }, [autoSendAt, lastVoiceAt]);

  const startInterview = useCallback(() => {
    if (!session?.liveReady) return;
    setPhase('live');
    // Started from the click, so the browser lets the call open the microphone and play audio.
    void liveCall.start(0);
  }, [liveCall, session]);

  /* -------------------------------------------------------------- rendering */

  const back = (
    <p className="iv-back">
      <Link href={`/applicant/jobs/${encodeURIComponent(jobId)}`}>
        <ArrowLeft size={16} aria-hidden="true" /> Back to the role
      </Link>
    </p>
  );

  if (loadError) {
    return (
      <>
        {back}
        <section className="iv-panel">
          <h1 className="iv-title">The interview room could not open</h1>
          <p className="iv-muted">{loadError}</p>
        </section>
      </>
    );
  }

  if (!session) {
    return (
      <>
        {back}
        <section className="iv-panel" aria-busy="true">
          <p className="eyebrow">Mock interview</p>
          <p className="iv-muted" role="status">
            Preparing the room. Gemini is reading the posting and your match gaps.
          </p>
        </section>
      </>
    );
  }

  const heading = (
    <header className="iv-head">
      <p className="eyebrow">Mock interview</p>
      <h1 className="iv-title">
        {session.jobTitle} at {session.company}
      </h1>
    </header>
  );

  if (session.locked) {
    return (
      <>
        {back}
        {heading}
        <section className="iv-panel">
          <h2>Not yet</h2>
          <p>{session.locked}</p>
          <p className="iv-muted">
            A mock interview opens when a role reaches <strong>Interviewing</strong> on your pipeline.
          </p>
          <Link className="ws-button" href="/applicant/pipeline">
            Go to the pipeline
          </Link>
        </section>
      </>
    );
  }

  const secondsLeft = autoSendAt === null ? 0 : Math.max(0, Math.ceil((autoSendAt - clock) / 1000));
  const callDown = phase === 'live' && !liveOn;

  return (
    <>
      {back}
      {heading}
      <div className="iv-room">
        {/* Always in the DOM so it is announced when it fills. */}
        <p className="iv-live" role="status" aria-live="polite">
          {busy ?? notice ?? ''}
        </p>

        <div className="iv-stage">
          <section className="iv-camera" aria-labelledby="iv-camera-heading">
            <h2 id="iv-camera-heading" className="iv-h3">
              You
            </h2>
            {/* A live self-view: there is no track to caption, and the transcript is its text equivalent. */}
            <video ref={videoRef} className="iv-video" muted playsInline aria-label="Your camera" />
            {cameraError ? (
              <>
                <p className="iv-warn">{cameraError}</p>
                <button type="button" className="ws-button ws-button--quiet" onClick={startCamera}>
                  Try the camera again
                </button>
              </>
            ) : null}

            <section className="iv-voice" aria-labelledby="iv-voice-heading">
              <h3 id="iv-voice-heading" className="iv-h3">
                Interviewer
              </h3>
              <PixelWave active={liveCall.status === 'live'} read={liveCall.levels} />
              <p className="iv-muted iv-small">
                {liveCall.status === 'live'
                  ? liveCall.speaking
                    ? 'Speaking. Talk over them and they will stop.'
                    : 'Listening.'
                  : liveCall.status === 'connecting'
                    ? 'Connecting.'
                    : phase === 'brief'
                      ? 'Joins by voice when you start.'
                      : phase === 'done'
                        ? 'The interview is over.'
                        : 'Not on the call.'}
              </p>
              {liveOn ? (
                <button type="button" className="ws-button ws-button--quiet iv-voice-button" onClick={liveCall.stop}>
                  Hang up
                </button>
              ) : null}
            </section>
          </section>

          <section className="iv-main" aria-labelledby="iv-main-heading">
            <h2 id="iv-main-heading" className="iv-h3">
              {phase === 'done' ? 'How it went' : 'Interview'}
            </h2>

            {phase === 'brief' ? <Brief session={session} onStart={startInterview} /> : null}

            {phase === 'live' && question ? (
              <>
                <p className="iv-progress">
                  Question {index + 1} of {session.questions.length} · {QUESTION_KIND_LABEL[question.kind]}
                </p>
                <div className="iv-question" role="region" aria-label="Current question" aria-live="polite" aria-atomic="true">
                  <p className="iv-question-text">{question.text}</p>
                  <p className="iv-muted">{question.because}</p>
                  {question.looksLike.length ? (
                    <details className="iv-hint">
                      <summary>What a strong answer has</summary>
                      <ul>
                        {question.looksLike.map((point) => (
                          <li key={point}>{point}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>

                <h3 className="iv-label" id="iv-said-heading">
                  What you said
                </h3>
                <div className="iv-said" role="log" aria-labelledby="iv-said-heading" aria-live="polite">
                  {said ? (
                    <p>{said}</p>
                  ) : (
                    <p className="iv-muted">
                      {liveCall.status === 'live' ? 'Answer out loud. Your words appear here when you pause.' : ''}
                    </p>
                  )}
                </div>

                <div className="iv-actions">
                  {callDown ? (
                    <button
                      type="button"
                      className="ws-button"
                      onClick={() => {
                        liveCall.takeSpeechSeconds();
                        void liveCall.start(index);
                      }}
                    >
                      Call the interviewer back
                    </button>
                  ) : null}
                  {autoSendAt !== null ? (
                    <>
                      <button type="button" className="ws-button" disabled={busy !== null} onClick={() => void send(false)}>
                        Send now <span aria-hidden="true">· {secondsLeft}</span>
                      </button>
                      <button
                        type="button"
                        className="ws-button ws-button--quiet"
                        onClick={() => {
                          setAutoSendAt(null);
                          setNotice('Held. Keep going, then send when you are ready.');
                        }}
                      >
                        Wait, I&apos;m not done
                      </button>
                    </>
                  ) : said.trim() ? (
                    <button type="button" className="ws-button" disabled={busy !== null} onClick={() => void send(false)}>
                      Send answer
                    </button>
                  ) : null}
                  {liveCall.status === 'live' ? (
                    <button type="button" className="ws-button ws-button--quiet" onClick={() => liveCall.repeat(index)}>
                      Ask it again
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="ws-button ws-button--quiet"
                    disabled={busy !== null}
                    onClick={() => void send(true)}
                  >
                    Skip this one
                  </button>
                </div>

                {critiques.length ? <CritiqueList critiques={critiques} questions={session.questions} /> : null}
              </>
            ) : null}

            {phase === 'done' && feedback ? <Readout feedback={feedback} questions={session.questions} /> : null}
          </section>
        </div>
      </div>
    </>
  );
}

function Brief({ session, onStart }: { session: InterviewSessionPayload; onStart: () => void }) {
  return (
    <>
      <p>
        {session.questions.length} questions, one at a time, on a live voice call. The interviewer asks each one out
        loud; answer out loud, and when you stop talking your answer is sent and the next question comes. Skipping
        shows up in the readout.
      </p>
      <p className="iv-muted">{QUESTION_SOURCE_LABEL[session.questionSource]}.</p>

      {session.degraded.length ? (
        <ul className="iv-degraded">
          {session.degraded.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}

      <button type="button" className="ws-button" disabled={!session.liveReady} onClick={onStart}>
        Start the interview
      </button>
      {session.liveReady ? <p className="iv-muted iv-small">Your browser will ask for the microphone.</p> : null}
    </>
  );
}

function CritiqueList({ critiques, questions }: { critiques: AnswerCritique[]; questions: InterviewQuestion[] }) {
  const titleFor = (id: string) => questions.find((question) => question.id === id)?.text ?? 'That question';
  return (
    <section className="iv-critiques" aria-labelledby="iv-critiques-heading">
      <h3 id="iv-critiques-heading" className="iv-h3">
        So far
      </h3>
      <ol>
        {critiques.map((critique) => (
          <li key={critique.questionId}>
            <p className="iv-critique-q">{titleFor(critique.questionId)}</p>
            <ul>
              {critique.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
              {critique.missing.map((point) => (
                <li key={point}>Missing: {point}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Readout({ feedback, questions }: { feedback: InterviewFeedback; questions: InterviewQuestion[] }) {
  return (
    <>
      <p className="iv-summary">{feedback.summary}</p>
      <CritiqueList critiques={feedback.critiques} questions={questions} />
      {feedback.unanswered.length ? (
        <section className="iv-critiques" aria-labelledby="iv-skipped-heading">
          <h3 id="iv-skipped-heading" className="iv-h3">
            Skipped
          </h3>
          <ul>
            {feedback.unanswered.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="iv-muted">
        This readout is saved with this application. Run the room again whenever you like; the questions are rewritten
        from the posting each time.
      </p>
    </>
  );
}
