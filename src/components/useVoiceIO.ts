'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { authedFetch } from '@/lib/authed-fetch';

import type { FaceMood } from './AgentFace';

/**
 * Speak one line, hear one answer. The building blocks for a SCRIPTED voice
 * flow (the gap interview), where the page decides what is asked and in what
 * order, rather than an open conversation with the agent.
 *
 *   open()  — call inside the click that starts the flow. Browsers only allow
 *             sound that begins from a gesture, so the AudioContext is created
 *             here and every later line plays through it.
 *   say()   — ElevenLabs text-to-speech. If voice fails the line still shows,
 *             held long enough to read.
 *   hear()  — records until the speaker goes quiet (~1.3 s after speech),
 *             transcribes it, and returns the text, or null if nothing was said.
 *   close() — stops everything and releases the microphone.
 *
 * Every call carries the Firebase ID token: the voice routes are signed-in only.
 */

export type IOPhase = 'off' | 'thinking' | 'speaking' | 'listening';

const TICK_MS = 100;
const CALIBRATE_MS = 400;
const END_SILENCE_MS = 1300;
const NO_SPEECH_MS = 9000;
const MAX_TURN_MS = 30000;

const MOOD: Record<IOPhase, FaceMood> = { off: 'idle', thinking: 'thinking', speaking: 'speaking', listening: 'listening' };

export class MicBlockedError extends Error {}

export function useVoiceIO() {
  const [phase, setPhase] = useState<IOPhase>('off');
  const live = useRef(false);
  const ctx = useRef<AudioContext | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);

  const close = useCallback(() => {
    live.current = false;
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

  useEffect(() => close, [close]);

  const open = useCallback(() => {
    if (live.current) return;
    live.current = true;
    const audio = new AudioContext();
    ctx.current = audio;
    void audio.resume();
  }, []);

  const say = useCallback(async (text: string) => {
    if (!live.current) return;
    setPhase('thinking');
    try {
      const res = await authedFetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok || !ctx.current || !live.current) throw new Error('tts');
      const buffer = await ctx.current.decodeAudioData(await res.arrayBuffer());
      if (!live.current || !ctx.current) return;
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
      if (!live.current) return;
      setPhase('speaking');
      await new Promise((r) => setTimeout(r, Math.min(9000, 1500 + text.length * 45)));
    }
  }, []);

  /** Records until quiet after speech. Null if they never started talking. */
  const record = useCallback(async (): Promise<Blob | null> => {
    if (!stream.current) {
      try {
        stream.current = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
      } catch {
        throw new MicBlockedError('Microphone blocked.');
      }
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
          !live.current ||
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
    return heard && live.current ? blob : null;
  }, []);

  const hear = useCallback(async (): Promise<string | null> => {
    if (!live.current) return null;
    const clip = await record();
    if (!clip || !live.current) return null;
    setPhase('thinking');
    try {
      const form = new FormData();
      form.append('audio', clip);
      const res = await authedFetch('/api/voice/stt', { method: 'POST', body: form });
      const text = res.ok ? ((await res.json()) as { text?: string }).text?.trim() ?? '' : '';
      return text || null;
    } catch {
      return null;
    }
  }, [record]);

  /** For the page to show "thinking" while it waits on its own requests. */
  const busy = useCallback(() => live.current && setPhase('thinking'), []);

  return { phase, mood: MOOD[phase], open, say, hear, busy, close, live };
}
