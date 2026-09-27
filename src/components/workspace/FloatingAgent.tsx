'use client';

/**
 * agentHire's face, floating over every workspace page.
 *
 * Mounted once in the workspace shell beside the chat drawer, so it survives
 * navigation between tabs exactly like the chat does, and a conversation keeps
 * going when the user clicks from Jobs to Pipeline. The agent is told which page
 * they are on at every turn.
 *
 *   the mic nose    shows the microphone: a slash through it while muted.
 *                   Press it (or anywhere on the face) to talk, again to mute.
 *                   Only this face has the nose.
 *   press + drag    move it, from anywhere on the face, the nose included
 *   Enter / Space   the same switch, for keyboards
 *
 * The nose is drawn but deliberately NOT its own 3D click target: its hit area
 * covers the middle of the face, where people grab it, and as a separate
 * control it swallowed the press that should have started a drag. Every press
 * goes through the one button below instead, which tells a click from a drag.
 *   press and drag  move it anywhere; where it was left is remembered
 *   Enter / Space   the same as a click, for keyboards
 *   arrow keys      move it (Shift for bigger steps)
 *
 * A press only counts as a click if the pointer barely moved, so dropping it
 * after a drag never toggles the microphone by accident.
 *
 * Every spoken turn is written to the shared conversation, so the chat drawer
 * shows the voice transcript beside anything typed, and the agent hears the
 * typed part too.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { AgentFaceLive } from '../AgentFaceLive';
import { useVoiceAgent } from '../useVoiceAgent';
import { useConversation } from './conversation';
import { NARROW_QUERY } from './panel-state';

const SIZE = 104;
/** How long the last line (a farewell, a note) stays up after the agent turns off. */
const AFTERGLOW_MS = 6000;
const MARGIN = 12;
/** Pointer travel, in px, below which a press is a click rather than a drag. */
const DRAG_THRESHOLD = 5;
const STORAGE_KEY = 'agenthire:floating-agent';

const GREETING = {
  text: "Hi, I'm agentHire. Ask me about your job matches, your pipeline, or your profile.",
  src: '/agenthire-dashboard-hello.mp3',
};

const HINT = {
  off: 'Press my mic nose to talk · drag to move',
  thinking: 'Thinking…',
  speaking: 'Speaking · press the nose to mute',
  listening: 'Listening · just talk, then pause',
} as const;

type Point = { x: number; y: number };

/**
 * Keep it on screen. `rightInset` is the width the chat drawer is taking on the
 * right, so an open drawer pushes the face aside instead of covering its input.
 */
function clamp(p: Point, rightInset = 0): Point {
  const maxX = Math.max(MARGIN, window.innerWidth - rightInset - SIZE - MARGIN);
  const maxY = Math.max(MARGIN, window.innerHeight - SIZE - MARGIN);
  return { x: Math.min(maxX, Math.max(MARGIN, p.x)), y: Math.min(maxY, Math.max(MARGIN, p.y)) };
}

function initialPosition(): Point {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Point | null;
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return clamp(saved);
  } catch {
    /* storage blocked or malformed: fall through to the default corner */
  }
  // Bottom right, clear of the chat drawer's tab at the top right.
  return clamp({ x: window.innerWidth - SIZE - 28, y: window.innerHeight - SIZE - 28 });
}

function remember(p: Point) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* a private window: it simply starts in the corner next time */
  }
}

export function FloatingAgent({ pageName }: { pageName: string | null }) {
  const pageRef = useRef(pageName);
  useEffect(() => {
    pageRef.current = pageName;
  }, [pageName]);
  const page = useCallback(() => pageRef.current, []);
  const conversation = useConversation();
  const voice = useVoiceAgent({
    greeting: GREETING,
    page,
    onTurn: conversation?.recordVoice,
    history: conversation?.history,
  });

  const [pos, setPos] = useState<Point | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; start: Point; origin: Point; moved: boolean } | null>(null);
  /** Set when a press turned into a drag, so the click that follows it is ignored. */
  const swallowClick = useRef(false);

  // How much of the right edge the chat drawer covers right now. The saved spot
  // is left alone; the face is only drawn clear of the drawer while it is open,
  // and goes back when it closes.
  const [rightInset, setRightInset] = useState(0);
  useEffect(() => {
    const root = document.documentElement;
    const measure = () => {
      // The drawer's final width, the same rule as --drawer-w in globals.css. Not
      // measured from the element: it is still sliding in when the attribute flips.
      // On narrow screens it overlays the whole page, and the face stays put.
      const open = root.dataset.transcript === 'open' && !window.matchMedia(NARROW_QUERY).matches;
      setRightInset(open ? Math.min(420, window.innerWidth - 72) : 0);
    };
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(root, { attributes: true, attributeFilter: ['data-transcript'] });
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // Position needs the window, so it is set after mount rather than during render.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading localStorage and the viewport, which only exist after mount
    setPos(initialPosition());
    const onResize = () => setPos((p) => (p ? clamp(p) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // When the agent turns off, keep its last line on screen briefly, then let it go.
  const [afterglow, setAfterglow] = useState(false);
  const wasActive = useRef(false);
  useEffect(() => {
    if (wasActive.current && !voice.active) {
      setAfterglow(true);
      const timer = setTimeout(() => setAfterglow(false), AFTERGLOW_MS);
      wasActive.current = voice.active;
      return () => clearTimeout(timer);
    }
    wasActive.current = voice.active;
  }, [voice.active]);

  const toggle = () => {
    if (voice.active) voice.stop();
    else void voice.start();
  };

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!pos || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: clamp(pos, rightInset), moved: false };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const dx = event.clientX - d.start.x;
    const dy = event.clientY - d.start.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!d.moved) {
      d.moved = true;
      setDragging(true);
    }
    setPos(clamp({ x: d.origin.x + dx, y: d.origin.y + dy }, rightInset));
  };

  const endDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    drag.current = null;
    if (d.moved) {
      swallowClick.current = true;
      setDragging(false);
      setPos((p) => {
        if (p) remember(p);
        return p;
      });
    }
  };

  const onClick = () => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    toggle();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 72 : 24;
    const delta: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const d = delta[event.key];
    if (!d || !pos) return;
    event.preventDefault();
    const next = clamp({ x: pos.x + d.x, y: pos.y + d.y }, rightInset);
    setPos(next);
    remember(next);
  };

  if (!pos) return null;
  const at = clamp(pos, rightInset);

  // The bubble opens toward whichever side of the screen has room.
  const bubbleLeft = at.x > (window.innerWidth - rightInset) / 2;
  const bubbleUp = at.y > window.innerHeight / 2;
  const caption = voice.caption;
  const showBubble = Boolean(caption) && (voice.active || afterglow);

  return (
    <div
      className={`fa ${dragging ? 'is-dragging' : ''} is-${voice.phase}`}
      style={{ left: at.x, top: at.y, width: SIZE, height: SIZE }}
    >
      <button
        type="button"
        className="fa__face"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={onClick}
        onKeyDown={onKeyDown}
        aria-pressed={voice.active}
        aria-label={
          voice.active
            ? 'agentHire voice agent is on. Press to turn it off. Arrow keys move it.'
            : 'Turn on the agentHire voice agent. Arrow keys move it.'
        }
      >
        <AgentFaceLive
          mood={voice.active ? voice.mood : 'idle'}
          size={SIZE}
          nose
          noseShape="mic"
          muted={!voice.active}
        />
      </button>

      <div
        className={`fa__bubble ${bubbleLeft ? 'is-left' : 'is-right'} ${bubbleUp ? 'is-up' : 'is-down'} ${showBubble ? 'is-shown' : ''}`}
        aria-live="polite"
      >
        {caption ? (
          <p className={caption.who === 'you' ? 'is-you' : undefined}>
            {caption.who === 'you' ? `You: ${caption.text}` : caption.text}
          </p>
        ) : null}
        <small>{HINT[voice.phase]}</small>
      </div>

      {!voice.active && !showBubble ? (
        <span className={`fa__hint ${bubbleLeft ? 'is-left' : 'is-right'}`} aria-hidden="true">
          {HINT.off}
        </span>
      ) : null}
    </div>
  );
}
