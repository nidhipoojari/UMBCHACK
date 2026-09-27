'use client';

import {
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'motion/react';
import { useEffect, useRef, useState } from 'react';

import { StoryArt } from './StoryArt';


type Stage = {
  n: string;
  /** Which drawing StoryArt paints. Kept apart from `n` so inserting a beat
   *  renumbers the counter without handing every later card the wrong art. */
  art: string;
  act: string;
  title: string;
  line: string;
};

/** The story, in thirteen beats. Four of what is broken, one of arrival, two of
 *  who it is for, five of how it works, one of where it goes. Each card is a
 *  live diagram of the beat; the words live underneath it. */
const STAGES: Stage[] = [
  {
    n: '01',
    art: 'applications',
    act: 'What is broken',
    title: 'Senior year. A hundred applications. Then another hundred.',
    line: 'Most are never answered, and nobody tells you which ones.',
  },
  {
    n: '02',
    art: 'forms',
    act: 'What is broken',
    title: 'The same eleven fields. Every single site.',
    line: 'Name, school, dates, upload the same PDF again. Re-typed, never reused.',
  },
  {
    n: '03',
    art: 'hours',
    act: 'What is broken',
    title: 'Five hours a week, and nothing back.',
    line: 'Multiply that by everyone doing it and the country loses three billion hours a year.',
  },
  {
    n: '04',
    art: 'ghost',
    act: 'What is broken',
    title: 'And some of those doors were never real.',
    line: 'Postings that exist to harvest a resume, from a company that was never hiring.',
  },
  {
    n: '05',
    art: 'face',
    act: 'The turn',
    title: 'So we built agentHire.',
    line: 'A career agent for students. It applies for you, and refuses out loud when something is wrong.',
  },
  {
    n: '06',
    art: 'voice',
    act: 'How it works',
    title: 'Just talk to it.',
    line: 'Say what you are looking for. No forms, no mouse, no thirty tabs.',
  },
  {
    n: '07',
    art: 'match',
    act: 'How it works',
    title: 'Your resume in, the right roles out.',
    line: 'Every recent posting, read against your resume, scored out of 100 with the gaps named. Not on keywords.',
  },
  {
    n: '08',
    art: 'alumni',
    act: 'Built for students',
    title: 'Ask the people who already got the job.',
    line: 'Pick your major and see how your campus’s graduates got hired: how fast, for how much, and through which door. Your agent asks theirs for you.',
  },
  {
    n: '09',
    art: 'progress',
    act: 'Built for students',
    title: 'A job search that feels like progress.',
    line: 'Daily energy, streaks and XP for every alumnus you reach. It counts people, not clicks, so it can only be earned.',
  },
  {
    n: '10',
    art: 'trust',
    act: 'How it works',
    title: 'First: is this employer real?',
    line: 'Five dimensions, each scored, each with a reason in plain English you can read.',
  },
  {
    n: '11',
    art: 'handshake',
    act: 'How it works',
    title: 'Your agent asks theirs to prove it.',
    line: 'Only once the certificate checks out does anything private leave your hands.',
  },
  {
    n: '12',
    art: 'handshake-reverse',
    act: 'How it works',
    title: 'Hiring? It runs both ways.',
    line: 'Their agent verifies yours the same way, so fabricated applicants stop at the door too.',
  },
  {
    n: '13',
    art: 'negotiation',
    act: 'The future',
    title: 'Agents negotiate. You decide.',
    line: 'They keep talking so you do not have to. You are brought in for the one part that matters.',
  },
];

const SUBTITLE = 'four beats of what is broken, then the machine that replaces it';

export function ArchitectureRail() {
  const sectionRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  // Cards are a fixed width, so the travel has to be measured rather than
  // derived from a fraction. Re-measured on resize so it stays flush.
  const [travel, setTravel] = useState(0);
  const [beat, setBeat] = useState(1);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => setTravel(Math.max(0, track.scrollWidth - track.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    return () => ro.disconnect();
  }, []);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end end'],
  });

  /**
   * Scroll position is the TARGET, not the answer.
   *
   * Mapping the track straight off `scrollYProgress` meant a wheel notch landed
   * as a hard step — a dozen discrete jerks rather than one carousel. The spring
   * chases the target instead, so the track carries a little momentum into and
   * out of every card and a coarse input still reads as a glide. Lenis smooths
   * the vertical axis; this is the horizontal one, and both are needed.
   */
  const eased = useSpring(scrollYProgress, {
    stiffness: 74,
    damping: 26,
    mass: 0.6,
    restDelta: 0.0002,
  });

  const x = useTransform(eased, [0, 1], [0, -travel]);

  // Which beat is centred. Guarded so scrolling re-renders once per beat over the
  // whole section rather than on every frame.
  useMotionValueEvent(eased, 'change', (v) => {
    const n = Math.min(STAGES.length, Math.max(1, Math.floor(v * STAGES.length) + 1));
    setBeat((prev) => (prev === n ? prev : n));
  });

  if (reduced) {
    return (
      <section className="rail rail--static" aria-labelledby="rail-h">
        <div className="rail__head">
          <h2 id="rail-h" className="rail__title">
            How it works
            <span>{SUBTITLE}</span>
          </h2>
        </div>
        <div className="rail__stack">
          {STAGES.map((s) => (
            <Card key={s.n} stage={s} />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section
      ref={sectionRef}
      className="rail"
      style={{ height: `${STAGES.length * 100}vh` }}
      aria-labelledby="rail-h"
    >
      <div className="rail__pin">
        <div className="rail__head">
          <h2 id="rail-h" className="rail__title">
            How it works
            <span>{SUBTITLE}</span>
          </h2>
          {/* The counter and the rule are the only chrome the carousel gets. The
              rule IS the hairline under the heading — it just fills in, so the
              section gains a position indicator without gaining a widget. */}
          <p className="rail__beat" aria-hidden="true">
            {String(beat).padStart(2, '0')}
            <span> / {STAGES.length}</span>
          </p>
          {/* originX must come from Motion, not CSS — it writes transform-origin
              itself and defaults to centre, which would grow the fill outward
              from the middle of the rule. */}
          <motion.span
            className="rail__progress"
            style={{ scaleX: eased, originX: 0 }}
            aria-hidden="true"
          />
        </div>
        <motion.div className="rail__track" ref={trackRef} style={{ x }}>
          {STAGES.map((s) => (
            <Card key={s.n} stage={s} />
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function Card({ stage }: { stage: Stage }) {
  return (
    <article className="stage">
      {/* Words first in the DOM so the heading labels the image that follows it;
          flex order paints them underneath. Tab and reading order are unchanged. */}
      <div className="stage__caption">
        <p className="stage__act">
          <span>{stage.n}</span>
          {stage.act}
        </p>
        <h3>{stage.title}</h3>
        <p className="stage__line">{stage.line}</p>
      </div>

      {/* A drawing of the beat, not a photograph of a mood. It animates only
          while it is on screen, and holds a correct still frame otherwise. */}
      <div className="stage__card">
        <StoryArt art={stage.art} />
      </div>
    </article>
  );
}
