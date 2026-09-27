'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { authedFetch } from '@/lib/authed-fetch';

import type { FaceMood } from './AgentFace';

/**
 * A hands-free voice conversation with the agent.
 *
 * start() — called from a click — greets the visitor, then loops: listen until
 * they stop talking, transcribe (ElevenLabs Scribe), ask /api/agent, speak the
 * reply (ElevenLabs, agentHire's voice), listen again. stop() ends it at any
 * point and releases the microphone.
 *
 * WHY WEB AUDIO FOR PLAYBACK. Browsers only allow sound that starts from a user
 * gesture. The AudioContext is created and resumed inside the click, and every
 * later reply plays through that same context, so replies that arrive seconds
 * after the click still play.
 *
 * END OF SPEECH is detected from loudness: a short calibration reads the room,
 * then the turn ends after ~1.3 s of quiet following speech. No push-to-talk.
 *
 * SIGNED IN ONLY. Every call carries the Firebase token (authedFetch), because
 * the voice routes and /api/agent refuse anonymous callers. The agent ends the
 * conversation itself when it calls end_conversation (`end: true` in its reply).
 */

/** What the agent says first. `src` is a saved clip of the same words, played instead of synthesizing them. */
export type Greeting = { text: string; src?: string };

export type VoiceToolCall = { name: string; result?: Record<string, unknown> };

export type VoiceAgentOptions = {
  greeting: Greeting;
  /** The page the user is on right now, read at each turn so it follows navigation. */
  page: () => string | null;
  /** Every spoken turn, as it happens: for a transcript shown elsewhere (the chat drawer). */
  onTurn?: (role: 'user' | 'agent', text: string, extra?: { toolCalls?: VoiceToolCall[]; end?: boolean }) => void;
  /** A shared conversation to send to the agent instead of this session's own turns. */
  history?: () => Turn[];
};

export type VoicePhase = 'off' | 'thinking' | 'speaking' | 'listening';

export type Caption = { who: 'agent' | 'you' | 'note'; text: string };

type Turn = { role: 'user' | 'agent'; text: string };

const TICK_MS = 100;
const CALIBRATE_MS = 400;
const END_SILENCE_MS = 1300;
const NO_SPEECH_MS = 8000;
const MAX_TURN_MS = 20000;
/** Two turns in a row with nothing heard ends the conversation. */
const MAX_MISSES = 2;

/**
 * True when the visitor is saying goodbye, which ends the conversation.
 * A short line with "bye" in it counts ("okay bye", "thanks, goodbye"); other
 * sign-offs must be the whole line, so "stop applying to that job" is a request,
 * not a goodbye.
 */
export function isGoodbye(text: string): boolean {
  const words = text
    .toLowerCase()
    .replace(/[^a-z' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return false;
  if (words.length <= 6 && words.some((w) => w === 'bye' || w === 'goodbye')) return true;
  const line = words.join(' ');
  return /^(ok(ay)? |alright |thanks? (you )?|thank you )*(see (you|ya)( later)?|that'?s all|that is all|stop|i'?m done|end (the )?(chat|conversation)|good ?night)( for now)?( thanks?( you)?)?$/.test(
    line,
  );
}

const MOOD: Record<VoicePhase, FaceMood> = {
  off: 'idle',
  thinking: 'thinking',
  speaking: 'speaking',
  listening: 'listening',
};

export function useVoiceAgent({ greeting, page, onTurn, history: sharedHistory }: VoiceAgentOptions) {
  const [phase, setPhase] = useState<VoicePhase>('off');
  const [caption, setCaption] = useState<Caption | null>(null);

  const active = useRef(false);
  const ctx = useRef<AudioContext | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const history = useRef<Turn[]>([]);
  // Held in refs so start() keeps a stable identity while the page changes under it.
  const greetingRef = useRef(greeting);
  const pageRef = useRef(page);
  const onTurnRef = useRef(onTurn);
  const sharedRef = useRef(sharedHistory);
  useEffect(() => {
    greetingRef.current = greeting;
    pageRef.current = page;
    onTurnRef.current = onTurn;
    sharedRef.current = sharedHistory;
  });

  const stop = useCallback(() => {
    active.current = false;
    try {
      source.current?.stop();
    } catch {
      /* already stopped */
    }
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void ctx.current?.close();
    ctx.current = null;
    setPhase('off');
  }, []);

  useEffect(() => stop, [stop]);

  /** Speak a line (or play its saved clip). If voice fails the words still show, held long enough to read. */
  const say = useCallback(async (text: string, src?: string) => {
    setPhase('thinking');
    try {
      const res = src
        ? await fetch(src)
        : await authedFetch('/api/voice/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          });
      if (!res.ok || !ctx.current || !active.current) throw new Error('tts');
      const buffer = await ctx.current.decodeAudioData(await res.arrayBuffer());
      if (!active.current || !ctx.current) return;
      setCaption({ who: 'agent', text });
      setPhase('speaking');
      await new Promise<void>((resolve) => {
        const node = ctx.current!.createBufferSource();
        node.buffer = buffer;
        node.connect(ctx.current!.destination);
        node.onended = () => resolve();
        source.current = node;
        node.start();
      });
    } catch {
      if (!active.current) return;
      setCaption({ who: 'agent', text });
      setPhase('speaking');
      await new Promise((r) => setTimeout(r, Math.min(9000, 1500 + text.length * 45)));
    }
  }, []);

  /** Record one turn; resolves when the visitor stops talking, or null if they never started. */
  const listen = useCallback(async (): Promise<Blob | null> => {
    if (!stream.current) {
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    }
    const audio = ctx.current!;
    const analyser = audio.createAnalyser();
    analyser.fftSize = 1024;
    const mic = audio.createMediaStreamSource(stream.current);
    mic.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);

    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream.current);
    recorder.current = rec;
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<Blob>((resolve) => {
      rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType }));
    });
    rec.start();
    setPhase('listening');

    let elapsed = 0;
    let floor = 0;
    let floorSamples = 0;
    let heard = false;
    let loudTicks = 0;
    let quietMs = 0;

    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        elapsed += TICK_MS;
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const s of samples) sum += s * s;
        const rms = Math.sqrt(sum / samples.length);

        if (elapsed <= CALIBRATE_MS) {
          floor += rms;
          floorSamples++;
        } else {
          const threshold = Math.max(0.012, (floor / Math.max(1, floorSamples)) * 3);
          if (rms > threshold) {
            loudTicks++;
            quietMs = 0;
            if (loudTicks >= 2) heard = true;
          } else {
            loudTicks = 0;
            if (heard) quietMs += TICK_MS;
          }
        }

        const finished =
          !active.current ||
          (heard && quietMs >= END_SILENCE_MS) ||
          (!heard && elapsed >= NO_SPEECH_MS) ||
          elapsed >= MAX_TURN_MS;
        if (finished) {
          clearInterval(timer);
          resolve();
        }
      }, TICK_MS);
    });

    mic.disconnect();
    if (rec.state === 'recording') rec.stop();
    const blob = await done;
    return heard && active.current ? blob : null;
  }, []);

  const start = useCallback(async () => {
    if (active.current) return;
    active.current = true;
    history.current = [];
    setCaption(null);

    // Created inside the click, so the browser lets it play sound later.
    const audio = new AudioContext();
    ctx.current = audio;
    void audio.resume();

    const hello = greetingRef.current;
    history.current.push({ role: 'agent', text: hello.text });
    onTurnRef.current?.('agent', hello.text);
    await say(hello.text, hello.src);

    let misses = 0;
    while (active.current) {
      let clip: Blob | null;
      try {
        clip = await listen();
      } catch {
        setCaption({ who: 'note', text: 'Your microphone is blocked. Allow it in the address bar, then tap me again.' });
        stop();
        return;
      }
      if (!active.current) return;

      let heardText = '';
      if (clip) {
        setPhase('thinking');
        try {
          const form = new FormData();
          form.append('audio', clip);
          const res = await authedFetch('/api/voice/stt', { method: 'POST', body: form });
          heardText = res.ok ? ((await res.json()) as { text?: string }).text?.trim() ?? '' : '';
        } catch {
          heardText = '';
        }
      }
      if (!active.current) return;

      if (!heardText) {
        misses++;
        if (misses >= MAX_MISSES) {
          setCaption({ who: 'note', text: "I didn't hear anything, so I'll stop here. Tap me whenever you want to talk." });
          stop();
          return;
        }
        const again = "Sorry, I didn't catch that. Could you say it again?";
        onTurnRef.current?.('agent', again);
        await say(again);
        continue;
      }
      misses = 0;

      if (isGoodbye(heardText)) {
        onTurnRef.current?.('user', heardText, { end: true });
        setCaption({ who: 'note', text: 'Goodbye! Tap me whenever you want to talk.' });
        stop();
        return;
      }

      setCaption({ who: 'you', text: heardText });
      history.current.push({ role: 'user', text: heardText });
      onTurnRef.current?.('user', heardText);
      setPhase('thinking');

      let reply = 'Sorry, I could not reach my brain just now. Please try again in a moment.';
      let end = false;
      let toolCalls: VoiceToolCall[] = [];
      try {
        const res = await authedFetch('/api/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: sharedRef.current?.() ?? history.current, page: pageRef.current() }),
        });
        const data = (await res.json()) as { reply?: string; error?: string; end?: boolean; toolCalls?: VoiceToolCall[] };
        reply = data.reply ?? data.error ?? reply;
        end = data.end === true;
        toolCalls = data.toolCalls ?? [];
      } catch {
        /* keep the fallback line */
      }
      if (!active.current) return;
      history.current.push({ role: 'agent', text: reply });
      onTurnRef.current?.('agent', reply, { toolCalls, end });
      await say(reply);
      // The agent decided the conversation is over: say goodbye, then let go of the mic.
      if (end) {
        stop();
        return;
      }
    }
  }, [listen, say, stop]);

  return { phase, mood: MOOD[phase], caption, start, stop, active: phase !== 'off' };
}
