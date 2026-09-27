'use client';

import { useEffect, useRef, useState } from 'react';

import type { FaceMood } from './AgentFace';
import { AgentFaceLive } from './AgentFaceLive';

/** A short loop of the states the agent really goes through on a job
 *  application, so the homepage shows the product rather than a mascot. */
const SCRIPT: { mood: FaceMood; caption: string; hold: number }[] = [
  { mood: 'idle', caption: 'Say “find me backend internships.”', hold: 3200 },
  { mood: 'listening', caption: 'Listening…', hold: 2400 },
  { mood: 'thinking', caption: 'Matching 512 roles to your skills and coursework…', hold: 3000 },
  { mood: 'speaking', caption: '“Nine fit. Shall I tailor your resume for the top three?”', hold: 3600 },
  { mood: 'happy', caption: 'Applied to Northstar Labs. Employer verified.', hold: 3000 },
  { mood: 'refusing', caption: 'Stopped. That employer could not prove who it is.', hold: 3800 },
];

/**
 * Tapping the face plays agentHire's one-line introduction.
 *
 * The audio is a saved file (public/agenthire-intro.mp3, generated once with
 * ElevenLabs in agentHire's voice), so playing it costs nothing and works even
 * if ElevenLabs is unreachable. The caption must match the recording word for
 * word; regenerate the file if this line changes.
 */
const INTRO_SRC = '/agenthire-intro.mp3';
const INTRO_LINE =
  "Hi, I'm agentHire, your voice-first job agent. I match you to roles and verify every employer first.";

export function AgentGreeter() {
  const [i, setI] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  // Load the clip up front so a tap plays it instantly.
  useEffect(() => {
    const clip = new Audio(INTRO_SRC);
    clip.preload = 'auto';
    const done = () => setSpeaking(false);
    clip.addEventListener('ended', done);
    clip.addEventListener('pause', done);
    audio.current = clip;
    return () => {
      clip.pause();
      clip.removeEventListener('ended', done);
      clip.removeEventListener('pause', done);
      audio.current = null;
    };
  }, []);

  useEffect(() => {
    if (speaking) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setTimeout(() => setI((n) => (n + 1) % SCRIPT.length), SCRIPT[i].hold);
    return () => clearTimeout(t);
  }, [i, speaking]);

  function toggle() {
    const clip = audio.current;
    if (!clip) return;
    if (speaking) {
      clip.pause();
      return;
    }
    clip.currentTime = 0;
    setSpeaking(true);
    clip.play().catch(() => setSpeaking(false));
  }

  const step = SCRIPT[i];
  const mood = speaking ? 'speaking' : step.mood;
  const caption = speaking ? INTRO_LINE : step.caption;

  return (
    <div className="greeter">
      <button
        type="button"
        className={`greeter__face${speaking ? ' is-speaking' : ''}`}
        onClick={toggle}
        aria-label={speaking ? 'Stop the introduction' : 'Hear agentHire introduce itself'}
        aria-pressed={speaking}
      >
        <AgentFaceLive mood={mood} size={260} />
      </button>

      <p
        className={[
          'greeter__caption',
          speaking ? 'is-live' : '',
          !speaking && step.mood === 'refusing' ? 'is-failure' : '',
          !speaking && step.mood === 'happy' ? 'is-success' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-live={speaking ? 'polite' : 'off'}
      >
        {caption}
      </p>

      <p className="greeter__hint" aria-hidden="true">
        {speaking ? 'Speaking · tap to stop' : 'Tap the face to hear agentHire'}
      </p>
    </div>
  );
}
