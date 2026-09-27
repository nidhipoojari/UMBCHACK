'use client';

import { useState } from 'react';

import { FlaskConical } from 'lucide-react';

import type { ConnectOutcome, GameState } from '@/lib/game-contract';

// The component carries its own stylesheet rather than leaning on
// workspace.css, which is only imported by WorkspaceShell. A meter that
// silently renders as three bare <ul>s anywhere outside that shell is the same
// trap VerifiedBadges was written to avoid.
import './game.css';

import { Achievements } from './Achievements';
import { EnergyMeter } from './EnergyMeter';
import { LevelUpMoment } from './LevelUpMoment';
import { StreakMeter } from './StreakMeter';
import { XpMeter } from './XpMeter';

/**
 * The head-up display: energy, streak, rank, achievements — and the level-up.
 *
 * IT TAKES THE OUTCOME, IT DOES NOT COMPUTE ONE. Every animation below is
 * driven by a field the server sent about the action the student just took:
 * `energySpent` tells the meter which pip drained, `xpAwarded` gives the
 * counter somewhere to count FROM, `streakExtended` fires the ring, `levelUp`
 * opens the moment, `unlocked` names the achievement that flashes. None of it
 * is inferred from two sets of totals, which is what stops a background
 * refetch setting off a fanfare nobody earned.
 *
 * WHAT WAS DELETED TO MAKE ROOM. The screen this replaces carried sentences
 * explaining the mechanics — that each person is worth 10 XP, that reaching
 * someone twice is worth nothing and is recorded as a refusal. Those are true
 * and they are now shown instead of said: the XP chip says "+10" as it is
 * awarded, and a second attempt on the same person moves no pip and no
 * counter, which is a faster way to learn the rule than reading it.
 */
export function GameHud({
  game,
  outcome,
  live,
}: {
  game: GameState;
  /** The most recent action, or null on a fresh page. */
  outcome: (ConnectOutcome & { seq: number }) | null;
  /** False while the totals come from the fixture rather than GET /api/game. */
  live: boolean;
}) {
  // What is remembered is the DISMISSAL, not the celebration. Opening the card
  // from an effect would render one frame of the new rank with no card, then
  // pop it in a frame later; deriving it means the moment is on screen in the
  // same paint as the number it is about. Keying on `seq` rather than on a
  // boolean also means a second level-up in the same session opens again
  // instead of being swallowed by a flag that was never reset.
  const [dismissed, setDismissed] = useState(0);

  // A refused or duplicate attempt is a real answer, and the right animation
  // for it is none: nothing was spent, so nothing should move. `counted` is
  // the flag that says so without the UI having to guess from a zero.
  const acted = outcome?.counted === true;
  const seq = outcome?.seq ?? 0;

  return (
    <>
      {!live ? (
        // Scoped to the HUD on purpose. The alumni numbers on this page are
        // real and PageHead correctly says so; only these totals are
        // placeholder until GET /api/game answers. One badge, on the part
        // that is actually invented.
        <p className="g-sample">
          <FlaskConical size={13} aria-hidden="true" />
          Sample game state
        </p>
      ) : null}

      <div className="g-hud">
        <EnergyMeter
          energy={game.energy}
          // The pip that just drained is the one at the new `remaining` index:
          // with 3 left of 5 the filled pips are 0–2, so spending one empties
          // index 2 and leaves 2 remaining.
          spending={acted && outcome!.energySpent > 0 ? game.energy.remaining : null}
        />
        <StreakMeter
          streak={game.streak}
          extended={acted && outcome!.streakExtended}
          seq={seq}
        />
        <XpMeter
          level={game.level}
          awarded={acted ? outcome!.xpAwarded : 0}
          levelUp={acted && outcome!.levelUp}
          seq={seq}
        />
      </div>

      <Achievements
        achievements={game.achievements}
        unlocked={acted ? outcome!.unlocked : []}
      />

      {acted && outcome!.levelUp && dismissed !== seq ? (
        <LevelUpMoment level={game.level} onClose={() => setDismissed(seq)} />
      ) : null}
    </>
  );
}
