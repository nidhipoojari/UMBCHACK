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

/**
 * The mock interview room. One question at a time; answers are typed, or
 * recorded and transcribed by Gemini, then critiqued as they go and summed up
 * in a readout at the end. The interviewer can read each question aloud with a
 * Gemini voice.
 *
 * The camera and microphone never open by themselves: each has a button, and
 * refusing either leaves a working typed interview. Video is a self-view only
 * and is never recorded or uploaded; audio is uploaded only to be transcribed.
 */
export function InterviewRoom({ jobId }: { jobId: string }) {
  const [session, setSession] = useState<InterviewSessionPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('brief');
  const [index, setIndex] = useState(0);

  const [draft, setDraft] = useState('');
  const [answers, setAnswers] = useState<InterviewAnswer[]>([]);
  const [critiques, setCritiques] = useState<AnswerCritique[]>([]);
  const [feedback, setFeedback] = useState<InterviewFeedback | null>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [readAloud, setReadAloud] = useState(true);
  const [speaking, setSpeaking] = useState(false);

  // What the candidate says on a live call goes straight into the answer box.
  const heardRef = useRef(false);
  const onHeard = useCallback((text: string) => {
    heardRef.current = true;
    setDraft((current) => (current + text).replace(/^\s+/, ''));
  }, []);
  const liveCall = useLiveInterviewer(jobId, session?.sessionId ?? '', { onHeard, onNotice: setNotice });
  const liveOn = liveCall.status === 'live' || liveCall.status === 'connecting';

  const preparedRef = useRef<InterviewSessionPayload | null | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  /** The voice meter for the current recording; see startLevelMeter. */
  const meterRef = useRef<LevelMeter | null>(null);
  const answerBoxRef = useRef<HTMLTextAreaElement | null>(null);
  /** Carried from the recording to the send, so pace is measured on speech only. */
  const spokenSecondsRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** Spoken questions by id, so a replay does not synthesize again. */
  const speechCache = useRef(new Map<string, Promise<string | null>>());

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

  /* ------------------------------------------------- camera and microphone */

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

  /* ------------------------------------------------------- the interviewer */

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
      };
      try {
        await audio.play();
      } catch {
        setSpeaking(false);
        setNotice('The browser blocked audio playback. Press "Read it aloud" to hear the question.');
      }
    },
    [speechFor],
  );

  // Read each new question aloud when that is on, and fetch the next one's
  // audio in the background so it is ready when this one is answered. The
  // first question's audio is fetched while the briefing is still on screen.
  const spokenFor = useRef<string | null>(null);
  useEffect(() => {
    // On a live call the interviewer asks the questions itself.
    if (!question || !session?.voiceReady || liveOn) return;
    if (phase === 'brief' && readAloud) void speechFor(question.id);
    if (phase !== 'live') return;
    const next = session.questions[index + 1];
    if (next) void speechFor(next.id);
    if (!readAloud || spokenFor.current === question.id) return;
    spokenFor.current = question.id;
    void speak(question);
  }, [index, liveOn, phase, question, readAloud, session, speak, speechFor]);

  /* ----------------------------------------------------------- the recording */

  const startRecording = useCallback(async () => {
    stopAudio();
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
    meterRef.current = startLevelMeter(stream);
    setRecording(true);
    setNotice('Recording your answer. Press stop when you are done.');
  }, [stopAudio]);

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || !session) return;
    const speechSeconds = meterRef.current?.stop() ?? 0;
    meterRef.current = null;

    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.stop();
    await stopped;
    recorderRef.current = null;
    setRecording(false);

    const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
    chunksRef.current = [];
    if (blob.size === 0) {
      setNotice('That recording came back empty. Type the answer instead.');
      return;
    }
    // Nothing is sent when the microphone heard no voice: given silence, the
    // model writes a sentence nobody said.
    if (speechSeconds < 0.5) {
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
      const payload = (await response.json()) as {
        ok?: boolean;
        text?: string;
        seconds?: number | null;
        reason?: string;
        error?: string;
      };
      if (!payload.ok) {
        setNotice(payload.reason ?? payload.error ?? 'That recording could not be transcribed.');
        return;
      }
      if (!payload.text) {
        setNotice('We heard nothing in that recording. Try again, or type the answer.');
        return;
      }
      setDraft((current) => (current.trim() ? `${current.trim()} ${payload.text}` : payload.text!));
      // Pace is measured over the speech itself, first word to last, not over
      // how long the record button was held.
      spokenSecondsRef.current = (spokenSecondsRef.current ?? 0) + speechSeconds;
      setNotice('Transcribed. Read it, fix anything it misheard, then send it.');
      answerBoxRef.current?.focus();
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(null);
    }
  }, [jobId, session]);

  /* ------------------------------------------------------------- the answers */

  const finish = useCallback(async (allAnswers: InterviewAnswer[]) => {
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
  }, [jobId, session, stopCamera]);

  const send = useCallback(
    async (skip: boolean) => {
      if (!session || !question) return;
      const text = skip ? '' : draft.trim();
      if (!skip && !text) {
        setNotice('Nothing in the answer box yet.');
        return;
      }

      stopAudio();
      setBusy(skip ? 'Skipping.' : 'Sending your answer.');
      // On a live call, pace comes from the microphone meter while they spoke.
      const liveSeconds = liveOn ? liveCall.takeSpeechSeconds() : 0;
      const spokenSeconds = skip
        ? null
        : liveOn && heardRef.current && liveSeconds > 0
          ? liveSeconds
          : spokenSecondsRef.current;
      const answer: InterviewAnswer = {
        questionId: question.id,
        text,
        source: spokenSeconds !== null ? 'spoken' : 'typed',
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
        heardRef.current = false;
        setNotice(null);
        setIndex((previous) => previous + 1);
        const last = index + 1 >= session.questions.length;
        // The room owns the order: the live interviewer is told what comes next.
        if (liveCall.status === 'live') {
          if (last) liveCall.end();
          else liveCall.ask(index + 1);
        }
        // The last answer ends the interview; no button to find.
        if (last) await finish(allAnswers);
      } catch (error) {
        setNotice((error as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [answers, draft, finish, index, jobId, liveCall, liveOn, question, session, stopAudio],
  );


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

            {session.voiceReady || session.liveReady ? (
              <section className="iv-voice" aria-labelledby="iv-voice-heading">
                <h3 id="iv-voice-heading" className="iv-h3">
                  Interviewer
                </h3>
                {session.liveReady ? (
                  <>
                    <PixelWave active={liveCall.status === 'live'} read={liveCall.levels} />
                    <p className="iv-muted iv-small">
                      {liveCall.status === 'live'
                        ? liveCall.speaking
                          ? 'The interviewer is speaking. Talk over them and they will stop.'
                          : 'The interviewer is listening.'
                        : liveCall.status === 'connecting'
                          ? 'Connecting the interviewer.'
                          : 'A live voice call with Gemini: the interviewer asks each question and hears your answer.'}
                    </p>
                    {liveOn ? (
                      <button type="button" className="ws-button ws-button--quiet iv-voice-button" onClick={liveCall.stop}>
                        Hang up
                      </button>
                    ) : phase === 'live' && question ? (
                      <button
                        type="button"
                        className="ws-button iv-voice-button"
                        onClick={() => {
                          stopAudio();
                          liveCall.takeSpeechSeconds();
                          void liveCall.start(index);
                        }}
                      >
                        {liveCall.status === 'idle' ? 'Talk to the interviewer live' : 'Call the interviewer again'}
                      </button>
                    ) : phase === 'brief' ? (
                      <p className="iv-muted iv-small">Start the interview, then call the interviewer.</p>
                    ) : null}
                  </>
                ) : null}
                {session.voiceReady && !liveOn ? (
                  <label className="iv-toggle">
                    <input type="checkbox" checked={readAloud} onChange={(event) => setReadAloud(event.target.checked)} />
                    {session.liveReady ? 'Without a live call, read each question aloud' : 'Read each question aloud'}
                  </label>
                ) : null}
              </section>
            ) : null}
          </section>

          <section className="iv-main" aria-labelledby="iv-main-heading">
            <h2 id="iv-main-heading" className="iv-h3">
              {phase === 'done' ? 'How it went' : 'Interview'}
            </h2>

            {phase === 'brief' ? <Brief session={session} onStart={() => setPhase('live')} /> : null}

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
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={
                    liveOn
                      ? 'Answer out loud and your words appear here. Edit anything misheard, then send.'
                      : 'Type it, or record it and edit what comes back.'
                  }
                />

                <div className="iv-actions">
                  <button type="button" className="ws-button" disabled={busy !== null || recording} onClick={() => void send(false)}>
                    Send answer
                  </button>
                  {liveOn ? null : recording ? (
                    <button type="button" className="ws-button ws-button--quiet iv-recording" onClick={() => void stopRecording()}>
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
                  {liveCall.status === 'live' ? (
                    <button type="button" className="ws-button ws-button--quiet" onClick={() => liveCall.repeat(index)}>
                      Ask it again
                    </button>
                  ) : session.voiceReady ? (
                    speaking ? (
                      <button type="button" className="ws-button ws-button--quiet" onClick={stopAudio}>
                        Stop reading
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="ws-button ws-button--quiet"
                        disabled={recording}
                        onClick={() => void speak(question)}
                      >
                        Read it aloud
                      </button>
                    )
                  ) : null}
                  <button
                    type="button"
                    className="ws-button ws-button--quiet"
                    disabled={busy !== null || recording}
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
        {session.questions.length} questions, one at a time. Answer them out loud if you can: speaking an answer is the
        part nobody rehearses. You can skip any of them, and skipping shows up in the readout.
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
 * Watches the microphone level while recording and returns, on stop, the
 * seconds from the first moment of voice to the last. Zero means no voice was
 * heard at all. The threshold rises with the room's own noise floor, so a
 * humming laptop fan does not count as speech.
 */
function startLevelMeter(stream: MediaStream): LevelMeter {
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
    }
  }, 40);

  return {
    stop: () => {
      window.clearInterval(timer);
      source.disconnect();
      void context.close();
      if (firstVoice === null || lastVoice === null) return 0;
      // Half a frame either side, so one loud frame still counts as a moment of voice.
      return Math.max(0.04, (lastVoice - firstVoice) / 1000 + 0.04);
    },
  };
}
