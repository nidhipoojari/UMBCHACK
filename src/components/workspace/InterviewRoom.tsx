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
import { toJobSlug } from '@/lib/job-slug';

type Phase = 'brief' | 'live' | 'done';

/** How long a finished spoken answer waits before it sends, so the candidate can keep going. */
const GRACE_MS = 2500;
/** Quiet this long after speaking ends a recording (when there is no live call). */
const RECORDING_SILENCE_MS = 2500;

/**
 * The mock interview room, hands-free. Starting the interview brings in the
 * live interviewer, a two-way voice call with Gemini that asks each question.
 * When the candidate stops talking, their words land in the answer box and are
 * sent after a short grace period; speaking again, typing, or "Wait, I'm not
 * done" holds it. The critique of each answer builds up underneath, and the
 * readout comes at the end.
 *
 * Without a live call (not set up, blocked, or hung up), the questions are read
 * aloud instead, and "Record answer" stops by itself on silence and is
 * transcribed by Gemini. Typing works throughout.
 *
 * The camera never opens by itself and is a self-view only: it is never
 * recorded or uploaded.
 */
export function InterviewRoom({ jobId }: { jobId: string }) {
  const [session, setSession] = useState<InterviewSessionPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('brief');
  const [index, setIndex] = useState(0);

  const [draft, setDraftState] = useState('');
  const [answers, setAnswers] = useState<InterviewAnswer[]>([]);
  const [critiques, setCritiques] = useState<AnswerCritique[]>([]);
  const [feedback, setFeedback] = useState<InterviewFeedback | null>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);

  /** When a finished spoken answer sends by itself (Date.now()), or null. */
  const [autoSendAt, setAutoSendAt] = useState<number | null>(null);
  const [clock, setClock] = useState(0);

  // The draft is read from timers and audio callbacks, so it lives in a ref too.
  const draftRef = useRef('');
  const setDraft = useCallback((value: string) => {
    draftRef.current = value;
    setDraftState(value);
  }, []);
  /** Whether the current draft came, at least partly, from speech. */
  const spokeRef = useRef(false);
  const scheduledAtRef = useRef(0);

  const scheduleAutoSend = useCallback(() => {
    if (!draftRef.current.trim()) return;
    scheduledAtRef.current = performance.now();
    setAutoSendAt(Date.now() + GRACE_MS);
    setClock(Date.now());
    setNotice('Got it. Your answer sends in a moment; keep talking to add more.');
  }, []);
  const holdAutoSend = useCallback(() => setAutoSendAt(null), []);

  const onHeard = useCallback(
    (text: string, finished: boolean) => {
      if (text) {
        spokeRef.current = true;
        setDraft((draftRef.current + text).replace(/^\s+/, ''));
        // Still talking: whatever was about to send waits for the end of this.
        if (!finished) setAutoSendAt(null);
      }
      if (finished) scheduleAutoSend();
    },
    [scheduleAutoSend, setDraft],
  );
  const liveCall = useLiveInterviewer(jobId, session?.sessionId ?? '', { onHeard, onNotice: setNotice });
  const liveOn = liveCall.status === 'live' || liveCall.status === 'connecting';

  const preparedRef = useRef<InterviewSessionPayload | null | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const meterRef = useRef<LevelMeter | null>(null);
  const answerBoxRef = useRef<HTMLTextAreaElement | null>(null);
  /** Seconds of speech in the current draft, so pace is measured on speech only. */
  const spokenSecondsRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** Spoken questions by id, so a replay does not synthesize again. */
  const speechCache = useRef(new Map<string, Promise<string | null>>());
  /** Once the candidate has recorded one answer, later questions record by themselves. */
  const autoRecordRef = useRef(false);
  const startRecordingRef = useRef<() => Promise<void>>(async () => {});
  const stopRecordingRef = useRef<() => Promise<void>>(async () => {});
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
    setCameraOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraOn(true);
    } catch (error) {
      const name = (error as DOMException).name;
      setCameraError(
        name === 'NotAllowedError'
          ? 'The browser blocked the camera. The interview works fine without it.'
          : `The camera could not start (${name || 'unknown error'}). The interview works fine without it.`,
      );
    }
  }, []);

  const stopAudio = useCallback(() => {
    audioRef.current?.pause();
    setSpeaking(false);
  }, []);

  // Release the camera, microphone and any playing question on unmount or when
  // the tab is hidden, so a room left in the background holds nothing open.
  useEffect(() => {
    const cache = speechCache.current;
    const releaseAll = () => {
      stopCamera();
      meterRef.current?.stop();
      meterRef.current = null;
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      micStreamRef.current?.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
      audioRef.current?.pause();
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') releaseAll();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      releaseAll();
      for (const pending of cache.values()) void pending.then((url) => url && URL.revokeObjectURL(url));
    };
  }, [stopCamera]);

  /* ----------------------------------------- the interviewer, without a live call */

  const question: InterviewQuestion | null = session?.questions[index] ?? null;

  const speechFor = useCallback(
    (questionId: string) => {
      if (!session) return Promise.resolve(null);
      let pending = speechCache.current.get(questionId);
      if (!pending) {
        pending = (async () => {
          const response = await authedFetch(`/api/interview/${encodeURIComponent(jobId)}/speak`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: session.sessionId, questionId }),
          });
          if (!response.ok) return null;
          return URL.createObjectURL(await response.blob());
        })().catch(() => null);
        speechCache.current.set(questionId, pending);
        // A failure is not cached, so the next attempt can try again.
        void pending.then((url) => {
          if (!url) speechCache.current.delete(questionId);
        });
      }
      return pending;
    },
    [jobId, session],
  );

  const speak = useCallback(
    async (target: InterviewQuestion) => {
      audioRef.current?.pause();
      setSpeaking(true);
      setNotice('The interviewer is reading the question.');
      const url = await speechFor(target.id);
      if (!url) {
        setSpeaking(false);
        setNotice('The interviewer voice is unavailable right now. The question is on screen.');
        return;
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        setSpeaking(false);
        setNotice(null);
        // After the first recorded answer, the next ones start recording as soon as the question ends.
        if (autoRecordRef.current) void startRecordingRef.current();
      };
      try {
        await audio.play();
      } catch {
        setSpeaking(false);
        setNotice('The browser blocked audio playback. Press "Read it again" to hear the question.');
      }
    },
    [speechFor],
  );

  // Without a live call, each new question is read aloud, and the next one's
  // audio is fetched in the background so it is ready in time.
  const spokenFor = useRef<string | null>(null);
  useEffect(() => {
    if (!question || !session?.voiceReady) return;
    if (liveOn) {
      // The live interviewer asked this one; do not read it again after a hang-up.
      spokenFor.current = question.id;
      return;
    }
    if (phase === 'brief' && !session.liveReady) void speechFor(question.id);
    if (phase !== 'live') return;
    const next = session.questions[index + 1];
    if (next) void speechFor(next.id);
    if (spokenFor.current === question.id) return;
    spokenFor.current = question.id;
    void speak(question);
  }, [index, liveOn, phase, question, session, speak, speechFor]);

  /* ----------------------------------------------------------- the recording */

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || !session) return;
    recorderRef.current = null;
    const speechSeconds = meterRef.current?.stop() ?? 0;
    meterRef.current = null;

    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.stop();
    await stopped;
    setRecording(false);

    const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
    chunksRef.current = [];
    // Nothing is sent when the microphone heard no voice: given silence, the
    // model writes a sentence nobody said.
    if (blob.size === 0 || speechSeconds < 0.5) {
      setNotice('We heard nothing in that recording. Check your microphone, then try again or type the answer.');
      return;
    }

    setBusy('Transcribing your answer.');
    try {
      const form = new FormData();
      form.append('audio', blob, 'answer');
      form.append('speech_seconds', speechSeconds.toFixed(2));
      const response = await authedFetch(`/api/interview/${encodeURIComponent(jobId)}/transcribe`, {
        method: 'POST',
        body: form,
      });
      const payload = (await response.json()) as { ok?: boolean; text?: string; reason?: string; error?: string };
      if (!payload.ok) {
        setNotice(payload.reason ?? payload.error ?? 'That recording could not be transcribed.');
        return;
      }
      if (!payload.text) {
        setNotice('We heard nothing in that recording. Try again, or type the answer.');
        return;
      }
      setDraft(draftRef.current.trim() ? `${draftRef.current.trim()} ${payload.text}` : payload.text);
      spokeRef.current = true;
      spokenSecondsRef.current = (spokenSecondsRef.current ?? 0) + speechSeconds;
      setBusy(null);
      scheduleAutoSend();
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy((current) => (current === 'Transcribing your answer.' ? null : current));
    }
  }, [jobId, scheduleAutoSend, session, setDraft]);

  const startRecording = useCallback(async () => {
    if (recorderRef.current) return;
    stopAudio();
    setAutoSendAt(null);
    let stream = micStreamRef.current;
    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStreamRef.current = stream;
      } catch (error) {
        const name = (error as DOMException).name;
        setNotice(
          name === 'NotAllowedError'
            ? 'The browser blocked the microphone. Type the answer instead.'
            : 'The microphone could not start. Type the answer instead.',
        );
        return;
      }
    }
    chunksRef.current = [];
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.start();
    recorderRef.current = recorder;
    autoRecordRef.current = true;
    meterRef.current = startLevelMeter(stream, {
      silenceMs: RECORDING_SILENCE_MS,
      onSilence: () => void stopRecordingRef.current(),
    });
    setRecording(true);
    setNotice('Listening. Answer out loud; it stops by itself when you finish.');
  }, [stopAudio]);

  useEffect(() => {
    startRecordingRef.current = startRecording;
    stopRecordingRef.current = stopRecording;
  }, [startRecording, stopRecording]);

  /* ------------------------------------------------------------- the answers */

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
        stopCamera();
      } catch (error) {
        setNotice((error as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [jobId, session, stopCamera],
  );

  const send = useCallback(
    async (skip: boolean) => {
      if (!session || !question) return;
      setAutoSendAt(null);
      const text = skip ? '' : draftRef.current.trim();
      if (!skip && !text) {
        setNotice('Nothing in the answer box yet.');
        return;
      }
      if (recorderRef.current) {
        meterRef.current?.stop();
        meterRef.current = null;
        recorderRef.current.stop();
        recorderRef.current = null;
        setRecording(false);
      }

      stopAudio();
      setBusy(skip ? 'Skipping.' : 'Sending your answer.');
      const liveSeconds = liveOn ? liveCall.takeSpeechSeconds() : 0;
      const spokenSeconds = skip
        ? null
        : !spokeRef.current
          ? null
          : liveOn
            ? liveSeconds > 0
              ? liveSeconds
              : null
            : spokenSecondsRef.current;
      const answer: InterviewAnswer = {
        questionId: question.id,
        text,
        source: spokeRef.current && !skip ? 'spoken' : 'typed',
        spokenSeconds,
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
            spokenSeconds: spokenSeconds ?? undefined,
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
        setDraft('');
        spokenSecondsRef.current = null;
        spokeRef.current = false;
        setNotice(null);
        setIndex((previous) => previous + 1);
        const last = index + 1 >= session.questions.length;
        // The room owns the order: the live interviewer is told what comes next.
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
    [answers, finish, index, jobId, liveCall, liveOn, question, session, setDraft, stopAudio],
  );

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // A finished spoken answer sends itself after the grace period, unless the
  // candidate started talking again in the meantime. Only stable values are
  // dependencies, so the countdown's own re-renders do not restart the timer.
  const lastVoiceAt = liveCall.lastVoiceAt;
  const liveOnRef = useRef(liveOn);
  useEffect(() => {
    liveOnRef.current = liveOn;
  }, [liveOn]);
  useEffect(() => {
    if (autoSendAt === null) return;
    const tick = window.setInterval(() => setClock(Date.now()), 250);
    const fire = window.setTimeout(
      () => {
        const voice = lastVoiceAt();
        if (liveOnRef.current && voice !== null && voice > scheduledAtRef.current + 300) {
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
    if (!session) return;
    setPhase('live');
    // Started from the click, so the browser lets the call open the microphone and play audio.
    if (session.liveReady) void liveCall.start(0);
  }, [liveCall, session]);

  /* -------------------------------------------------------------- rendering */

  const back = (
    <p className="iv-back">
      <Link href={`/applicant/jobs/${toJobSlug(jobId)}`}>
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
      <p className="iv-muted">Camera optional and never recorded. Everything works typed.</p>
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
            {/* A live self-view: there is no track to caption, and the answer box is its text equivalent. */}
            <video ref={videoRef} className="iv-video" muted playsInline aria-label="Your camera preview" />
            {!cameraOn ? (
              <>
                <button type="button" className="ws-button ws-button--quiet" onClick={() => void startCamera()}>
                  Turn on camera
                </button>
                <p className="iv-muted iv-small">Optional, for rehearsing to your own face. Nothing is recorded or uploaded.</p>
              </>
            ) : (
              <button type="button" className="ws-button ws-button--quiet" onClick={stopCamera}>
                Turn the camera off
              </button>
            )}
            {cameraError ? <p className="iv-warn">{cameraError}</p> : null}

            {session.liveReady || session.voiceReady ? (
              <section className="iv-voice" aria-labelledby="iv-voice-heading">
                <h3 id="iv-voice-heading" className="iv-h3">
                  Interviewer
                </h3>
                {session.liveReady ? <PixelWave active={liveCall.status === 'live'} read={liveCall.levels} /> : null}
                <p className="iv-muted iv-small">
                  {liveCall.status === 'live'
                    ? liveCall.speaking
                      ? 'Speaking. Talk over them and they will stop.'
                      : 'Listening.'
                    : liveCall.status === 'connecting'
                      ? 'Connecting.'
                      : phase === 'brief'
                        ? session.liveReady
                          ? 'Calls in when you start, on a live voice call with Gemini.'
                          : 'Reads each question aloud with a Gemini voice.'
                        : speaking
                          ? 'Reading the question.'
                          : 'Not on a live call. Questions are read aloud instead.'}
                </p>
                {phase === 'live' && session.liveReady ? (
                  liveOn ? (
                    <button type="button" className="ws-button ws-button--quiet iv-voice-button" onClick={liveCall.stop}>
                      Hang up
                    </button>
                  ) : question ? (
                    <button
                      type="button"
                      className="ws-button ws-button--quiet iv-voice-button"
                      onClick={() => {
                        stopAudio();
                        liveCall.takeSpeechSeconds();
                        void liveCall.start(index);
                      }}
                    >
                      Call the interviewer back
                    </button>
                  ) : null
                ) : null}
              </section>
            ) : null}
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

                <label className="iv-label" htmlFor="iv-answer">
                  Your answer
                </label>
                <textarea
                  id="iv-answer"
                  ref={answerBoxRef}
                  className="iv-answer"
                  rows={8}
                  value={draft}
                  onChange={(event) => {
                    // Typing holds an automatic send: they are editing.
                    holdAutoSend();
                    setDraft(event.target.value);
                  }}
                  placeholder={
                    liveOn
                      ? 'Answer out loud. Your words appear here, and send by themselves when you stop talking.'
                      : 'Type your answer, or record it.'
                  }
                />

                <div className="iv-actions">
                  <button
                    type="button"
                    className="ws-button"
                    disabled={busy !== null || !draft.trim()}
                    onClick={() => void send(false)}
                  >
                    {autoSendAt !== null ? (
                      <>
                        Send now <span aria-hidden="true">· {secondsLeft}</span>
                      </>
                    ) : (
                      'Send answer'
                    )}
                  </button>
                  {autoSendAt !== null ? (
                    <button
                      type="button"
                      className="ws-button ws-button--quiet"
                      onClick={() => {
                        holdAutoSend();
                        setNotice('Held. Keep going, then send when you are ready.');
                        answerBoxRef.current?.focus();
                      }}
                    >
                      Wait, I&apos;m not done
                    </button>
                  ) : null}
                  {liveCall.status === 'live' ? (
                    <button type="button" className="ws-button ws-button--quiet" onClick={() => liveCall.repeat(index)}>
                      Ask it again
                    </button>
                  ) : liveOn ? null : (
                    <>
                      {recording ? (
                        <button
                          type="button"
                          className="ws-button ws-button--quiet iv-recording"
                          onClick={() => void stopRecording()}
                        >
                          Stop recording
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="ws-button ws-button--quiet"
                          disabled={busy !== null}
                          onClick={() => void startRecording()}
                        >
                          Record answer
                        </button>
                      )}
                      {session.voiceReady ? (
                        <button
                          type="button"
                          className="ws-button ws-button--quiet"
                          disabled={recording || speaking}
                          onClick={() => void speak(question)}
                        >
                          Read it again
                        </button>
                      ) : null}
                    </>
                  )}
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
        {session.questions.length} questions, one at a time.{' '}
        {session.liveReady
          ? 'The interviewer calls in and asks each one out loud. Answer out loud: when you stop talking, your answer is sent and the next question comes.'
          : 'Each question is read aloud. Record your answer and it stops by itself when you finish, or type it.'}{' '}
        You can type instead at any point, and skipping shows up in the readout.
      </p>
      <p className="iv-muted">{QUESTION_SOURCE_LABEL[session.questionSource]}.</p>

      {session.degraded.length ? (
        <ul className="iv-degraded">
          {session.degraded.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}

      <button type="button" className="ws-button" onClick={onStart}>
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

/* ------------------------------------------------------------ voice meter */

type LevelMeter = { stop: () => number };

/**
 * Watches the microphone level while recording. `onSilence` fires once, after
 * voice has been heard and then `silenceMs` of quiet. `stop()` returns the
 * seconds from the first moment of voice to the last; zero means no voice was
 * heard at all. The threshold rises with the room's own noise floor, so a
 * humming laptop fan does not count as speech.
 */
function startLevelMeter(
  stream: MediaStream,
  { silenceMs, onSilence }: { silenceMs: number; onSilence: () => void },
): LevelMeter {
  let context: AudioContext;
  try {
    context = new AudioContext();
  } catch {
    // No Web Audio: assume the whole recording is speech and let the server's
    // words-per-second check catch an invented transcript.
    const started = performance.now();
    return { stop: () => (performance.now() - started) / 1000 };
  }
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);

  let floor = Infinity;
  let firstVoice: number | null = null;
  let lastVoice: number | null = null;
  let silenced = false;

  const timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const value of samples) sum += value * value;
    const rms = Math.sqrt(sum / samples.length);
    floor = Math.min(floor, rms);
    const now = performance.now();
    if (rms > Math.max(0.012, floor * 4)) {
      firstVoice ??= now;
      lastVoice = now;
    } else if (!silenced && lastVoice !== null && now - lastVoice > silenceMs) {
      silenced = true;
      onSilence();
    }
  }, 40);

  return {
    stop: () => {
      window.clearInterval(timer);
      source.disconnect();
      void context.close().catch(() => {});
      if (firstVoice === null || lastVoice === null) return 0;
      // Half a frame either side, so one loud frame still counts as a moment of voice.
      return Math.max(0.04, (lastVoice - firstVoice) / 1000 + 0.04);
    },
  };
}
