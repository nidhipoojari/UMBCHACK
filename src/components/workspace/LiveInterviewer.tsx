'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { authedFetch } from '@/lib/authed-fetch';
import type { InterviewLiveTicket } from '@/lib/interview-contract';

/**
 * A live, two-way voice call with the interviewer: the microphone streams to
 * the relay (services/interview-live), which runs Gemini Live on Vertex, and
 * the interviewer's voice streams back. The candidate can talk over the
 * interviewer and it stops.
 *
 * The interviewer runs the conversation and keeps the room in step: the relay
 * reports each question it moves to, what the candidate said to the previous
 * one, and the end of the interview.
 */

export type LiveStatus = 'idle' | 'connecting' | 'live' | 'ended' | 'failed';

/** The relay's audio formats: 16 kHz in, 24 kHz out, 16-bit mono PCM both ways. */
const INPUT_RATE = 16_000;
const OUTPUT_RATE = 24_000;
/** Microphone audio is sent in 100 ms frames. */
const FRAME_SAMPLES = INPUT_RATE / 10;

// Copies each block of microphone samples to the main thread.
const CAPTURE_WORKLET = `
class Capture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor('capture', Capture);
`;

type Handlers = {
  /** The interviewer moved to this question (0-based). */
  onQuestion: (index: number) => void;
  /**
   * What the candidate said to a question, once the interviewer moved past it,
   * and how long they spoke for (first to last moment of voice), for pacing.
   */
  onAnswer: (index: number, text: string, spokenSeconds: number) => void;
  /** The interviewer ended the interview. */
  onFinished: () => void;
  /** A status sentence for the room's live region. */
  onNotice: (text: string | null) => void;
};

export function useLiveInterviewer(jobId: string, sessionId: string, handlerProps: Handlers) {
  const [status, setStatus] = useState<LiveStatus>('idle');
  const [speaking, setSpeaking] = useState(false);

  // Everything the audio callbacks touch lives in one ref, so they never close
  // over stale state.
  const live = useRef<{
    ws: WebSocket | null;
    mic: MediaStream | null;
    capture: AudioContext | null;
    playback: AudioContext | null;
    analyser: AnalyserNode | null;
    sources: Set<AudioBufferSourceNode>;
    playAt: number;
    pending: Float32Array[];
    pendingLength: number;
    /** Voice on the microphone since the last takeSpeechSeconds(), for pacing. */
    floor: number;
    firstVoice: number | null;
    lastVoice: number | null;
  }>({
    ws: null,
    mic: null,
    capture: null,
    playback: null,
    analyser: null,
    sources: new Set(),
    playAt: 0,
    pending: [],
    pendingLength: 0,
    floor: Infinity,
    firstVoice: null,
    lastVoice: null,
  });
  const handlers = useRef(handlerProps);
  useEffect(() => {
    handlers.current = handlerProps;
  });

  const silence = useCallback(() => {
    const state = live.current;
    for (const source of state.sources) {
      try {
        source.stop();
      } catch {
        // Already finished.
      }
    }
    state.sources.clear();
    state.playAt = 0;
    setSpeaking(false);
  }, []);

  const teardown = useCallback(() => {
    const state = live.current;
    silence();
    state.ws?.close();
    state.ws = null;
    state.mic?.getTracks().forEach((track) => track.stop());
    state.mic = null;
    void state.capture?.close().catch(() => {});
    state.capture = null;
    void state.playback?.close().catch(() => {});
    state.playback = null;
    state.analyser = null;
    state.pending = [];
    state.pendingLength = 0;
  }, [silence]);

  /** Queue one chunk of the interviewer's voice right after the previous one. */
  const play = useCallback((data: ArrayBuffer) => {
    const state = live.current;
    const context = state.playback;
    if (!context || !state.analyser) return;
    const samples = new Int16Array(data);
    const buffer = context.createBuffer(1, samples.length, OUTPUT_RATE);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) channel[index] = samples[index] / 32768;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(state.analyser);
    state.playAt = Math.max(state.playAt, context.currentTime + 0.05);
    source.start(state.playAt);
    state.playAt += buffer.duration;
    state.sources.add(source);
    setSpeaking(true);
    source.onended = () => {
      state.sources.delete(source);
      if (state.sources.size === 0) setSpeaking(false);
    };
  }, []);

  /** Downsample a block of microphone audio to 16 kHz and send it in 100 ms frames. */
  const capture = useCallback((block: Float32Array, rate: number) => {
    const state = live.current;
    let sum = 0;
    for (const value of block) sum += value * value;
    const rms = Math.sqrt(sum / (block.length || 1));
    state.floor = Math.min(state.floor, rms);
    if (rms > Math.max(0.012, state.floor * 4)) {
      const now = performance.now();
      state.firstVoice ??= now;
      state.lastVoice = now;
    }
    const ratio = rate / INPUT_RATE;
    const length = Math.floor(block.length / ratio);
    const resampled = new Float32Array(length);
    for (let index = 0; index < length; index += 1) resampled[index] = block[Math.floor(index * ratio)];
    state.pending.push(resampled);
    state.pendingLength += length;
    if (state.pendingLength < FRAME_SAMPLES) return;

    const frame = new Int16Array(state.pendingLength);
    let offset = 0;
    for (const part of state.pending) {
      for (let index = 0; index < part.length; index += 1) {
        const value = Math.max(-1, Math.min(1, part[index]));
        frame[offset + index] = value < 0 ? value * 32768 : value * 32767;
      }
      offset += part.length;
    }
    state.pending = [];
    state.pendingLength = 0;
    if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(frame.buffer);
  }, []);

  const start = useCallback(
    async (index: number) => {
      teardown();
      setStatus('connecting');
      handlers.current.onNotice('Connecting the interviewer.');
      try {
        const response = await authedFetch(`/api/interview/${encodeURIComponent(jobId)}/live`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });
        const pass = (await response.json()) as InterviewLiveTicket & { error?: string };
        if (!response.ok) throw new Error(pass.error ?? `The live interviewer is unavailable (${response.status}).`);

        const mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        const state = live.current;
        state.mic = mic;

        state.playback = new AudioContext({ sampleRate: OUTPUT_RATE });
        state.analyser = state.playback.createAnalyser();
        state.analyser.fftSize = 256;
        state.analyser.connect(state.playback.destination);

        state.capture = new AudioContext();
        const workletUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'application/javascript' }));
        await state.capture.audioWorklet.addModule(workletUrl);
        URL.revokeObjectURL(workletUrl);
        const node = new AudioWorkletNode(state.capture, 'capture');
        const rate = state.capture.sampleRate;
        node.port.onmessage = (event: MessageEvent<Float32Array>) => capture(event.data, rate);
        state.capture.createMediaStreamSource(mic).connect(node);

        const ws = new WebSocket(pass.url);
        ws.binaryType = 'arraybuffer';
        state.ws = ws;
        ws.onopen = () => ws.send(JSON.stringify({ type: 'start', ticket: pass.ticket, index }));
        ws.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
          if (typeof event.data !== 'string') return play(event.data);
          const message = JSON.parse(event.data) as { type: string; index?: number; text?: string; message?: string };
          if (message.type === 'ready') {
            setStatus('live');
            handlers.current.onNotice(null);
          } else if (message.type === 'question' && typeof message.index === 'number') {
            handlers.current.onQuestion(message.index);
          } else if (message.type === 'answer' && typeof message.index === 'number') {
            const state = live.current;
            const span =
              state.firstVoice !== null && state.lastVoice !== null ? (state.lastVoice - state.firstVoice) / 1000 : 0;
            state.firstVoice = null;
            state.lastVoice = null;
            handlers.current.onAnswer(message.index, message.text ?? '', span);
          } else if (message.type === 'finished') {
            handlers.current.onFinished();
          } else if (message.type === 'interrupted') {
            silence();
          } else if (message.type === 'error' && message.message) {
            handlers.current.onNotice(message.message);
          }
        };
        ws.onclose = () => {
          if (live.current.ws !== ws) return;
          teardown();
          setStatus((current) => (current === 'failed' ? current : 'ended'));
        };
        ws.onerror = () => {
          setStatus('failed');
          handlers.current.onNotice('The live interviewer could not connect. Try calling them back.');
        };
      } catch (error) {
        teardown();
        setStatus('failed');
        const name = (error as DOMException).name;
        handlers.current.onNotice(
          name === 'NotAllowedError'
            ? 'The browser blocked the microphone, so the interviewer cannot hear you. Allow it in the address bar, then call them back.'
            : (error as Error).message,
        );
      }
    },
    [capture, jobId, play, sessionId, silence, teardown],
  );

  const sendMessage = useCallback((message: Record<string, unknown>) => {
    const ws = live.current.ws;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }, []);

  const skip = useCallback(() => sendMessage({ type: 'skip' }), [sendMessage]);
  const end = useCallback(() => {
    sendMessage({ type: 'end' });
    // The goodbye plays, then the relay closes the call.
  }, [sendMessage]);
  const stop = useCallback(() => {
    teardown();
    setStatus('ended');
  }, [teardown]);

  /** The interviewer's output spectrum, for the wave. Empty when not connected. */
  const levels = useCallback((): Uint8Array => {
    const analyser = live.current.analyser;
    if (!analyser) return new Uint8Array(0);
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    return data;
  }, []);

  // Hang up on unmount and when the tab is hidden: a call left in a background
  // tab would keep the microphone open.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && live.current.ws) {
        teardown();
        setStatus('ended');
      }
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      teardown();
    };
  }, [teardown]);

  return { status, speaking, start, skip, end, stop, levels };
}

/** Columns and rows of the pixel wave. */
const COLUMNS = 48;
const ROWS = 12;

/**
 * The interviewer's voice as a grid of squares: each column is one frequency
 * band of the actual output audio, lit from the middle out. It is flat when
 * the interviewer is silent, and static under prefers-reduced-motion. Drawn on
 * a canvas; the status line beside it says the same thing in words.
 */
export function PixelWave({ active, read }: { active: boolean; read: () => Uint8Array }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const readRef = useRef(read);
  useEffect(() => {
    readRef.current = read;
  }, [read]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ink = getComputedStyle(canvas).getPropertyValue('color').trim() || '#000';
    const cell = Math.floor(canvas.width / COLUMNS);
    const size = cell - Math.max(1, Math.floor(cell * 0.18));

    const draw = (levels: number[]) => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = ink;
      for (let column = 0; column < COLUMNS; column += 1) {
        const lit = Math.max(1, Math.round(levels[column] * ROWS));
        const from = Math.floor((ROWS - lit) / 2);
        for (let row = from; row < from + lit; row += 1) {
          context.globalAlpha = 0.35 + 0.65 * (1 - Math.abs(row - (ROWS - 1) / 2) / (ROWS / 2));
          context.fillRect(column * cell, row * cell, size, size);
        }
      }
      context.globalAlpha = 1;
    };

    if (!active || reduced) {
      draw(new Array(COLUMNS).fill(0));
      return;
    }

    const smoothed = new Array<number>(COLUMNS).fill(0);
    let frame = 0;
    const tick = () => {
      const data = readRef.current();
      const bins = data.length || 1;
      for (let column = 0; column < COLUMNS; column += 1) {
        // Speech sits in the lower part of the spectrum.
        const next = (data[Math.floor((column / COLUMNS) * bins * 0.6)] ?? 0) / 255;
        smoothed[column] = next > smoothed[column] ? next : smoothed[column] * 0.82 + next * 0.18;
      }
      draw(smoothed);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active]);

  return <canvas ref={canvasRef} className="iv-wave" width={COLUMNS * 8} height={ROWS * 8} aria-hidden="true" />;
}
