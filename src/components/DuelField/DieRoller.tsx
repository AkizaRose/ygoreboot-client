import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { DieRollData } from '../Matchmaking/useMultiplayerDuel';
import diceIcon from '../../assets/ui/duelfield/dice.png';
import './DieRoller.css';

// How long the rapid "tumbling" animation runs before settling on the
// real, final result — and how often it swaps to a new random face
// during that time.
// Exported so MultiplayerDuelFieldPage's own handleRollDie can delay its
// "[Player] rolled a [number]" chat announcement until the animation
// here has actually finished, rather than posting the result to chat
// text the instant the roll starts (which would spoil the whole point
// of watching it tumble first) — kept as one shared constant so the two
// can never drift out of sync with each other.
export const ROLL_DURATION_MS = 900;
const ROLL_TICK_MS = 80;

// Classic 6-sided pip layouts, as positions in a 3x3 grid (0 = top-left,
// 8 = bottom-right) — lets every face be drawn with plain CSS dots
// rather than needing six separate image assets.
const PIP_LAYOUTS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function DieFace({ value }: { value: number }) {
  const active = new Set(PIP_LAYOUTS[value] ?? []);
  return (
    <div className="DieRoller-face">
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={`DieRoller-pip${active.has(i) ? ' DieRoller-pip--on' : ''}`} />
      ))}
    </div>
  );
}

// Re-exported so call sites that only ever touch this module (never the
// hook directly) can still import the type from here — the canonical
// declaration lives in useMultiplayerDuel.ts, alongside DuelDoc's own
// player1DieRoll/player2DieRoll fields it describes.
export type { DieRollData };

interface DieRollButtonProps {
  // Only used to disable the button for as long as a roll started from
  // THIS side is currently showing (mid-tumble, or settled but not yet
  // auto-cleared) — this button no longer renders the tumble/result
  // itself (see DieRollDisplay below, which is what players actually
  // watch), so `roll` here exists purely to stop a player mashing Roll
  // again while their last one is still on screen, not to drive any
  // visible face of its own.
  roll: DieRollData | null;
  onRoll: () => void;
}

// The clickable trigger placed on the board (see DuelField's own
// deckRow) — always shows the same static dice icon, in every state.
// Where the roll is actually SEEN now is DieRollDisplay below, shared
// and centered for both players via the reveal zone, so this button's
// only job is starting a roll (and refusing to start a second one while
// its own is still being shown).
export function DieRollButton({ roll, onRoll }: DieRollButtonProps) {
  return (
    <button
      type="button"
      className="DieRoller-button"
      onClick={onRoll}
      disabled={roll !== null}
      title="Roll a die"
    >
      <img src={diceIcon} alt="Roll a die" className="DieRoller-buttonIcon" />
    </button>
  );
}

interface DieRollDisplayProps {
  // The roll currently being shown — shared/synced (DuelDoc's own
  // player1DieRoll/player2DieRoll, via useMultiplayerDuel's own
  // myDieRoll/opponentDieRoll) rather than local component state, so
  // BOTH clients animate the exact same tumble and settle on the exact
  // same result at the exact same time, purely by both deriving
  // everything from the same shared startedAt/rollId/result — no direct
  // client-to-client messaging of any kind needed for that to work.
  roll: DieRollData;
}

// The actual tumbling/settled die face — rendered once, centered in the
// shared reveal zone (see MultiplayerDuelFieldPage's own boardStage),
// the same "no whose-side-is-this" treatment the Hand's own Reveal
// action gets (see getRevealZoneSlot's own comment), rather than at
// either player's own button or beside either avatar. Purely a display:
// no button, no onRoll, nothing clickable.
export function DieRollDisplay({ roll }: DieRollDisplayProps) {
  // Ticks this component every ROLL_TICK_MS for as long as the current
  // roll is still mid-animation — purely to force a re-render so the
  // elapsed-time math below picks up the passage of time; the actual
  // "what face/result to show right now" is always freshly recomputed
  // from roll.startedAt at render time, never stored in this state
  // itself. Restarts cleanly whenever roll.rollId changes (a new roll
  // starting), and stops on its own once the current one has settled.
  const [, setTick] = useState(0);
  useEffect(() => {
    const elapsed = () => Date.now() - roll.startedAt;
    if (elapsed() >= ROLL_DURATION_MS) return;
    const intervalId = window.setInterval(() => {
      setTick((n) => n + 1);
      if (elapsed() >= ROLL_DURATION_MS) window.clearInterval(intervalId);
    }, ROLL_TICK_MS);
    return () => window.clearInterval(intervalId);
  }, [roll.rollId, roll.startedAt]);

  const elapsed = Date.now() - roll.startedAt;
  const rolling = elapsed < ROLL_DURATION_MS;
  const tickIndex = Math.floor(elapsed / ROLL_TICK_MS);
  // A random face during the tumble itself — never the real result, and
  // never needs to match between clients (purely decorative; each
  // client's tumble flickers independently, they just start/stop at the
  // same shared moment and land on the same real final result below).
  const displayValue = rolling ? 1 + Math.floor(Math.random() * 6) : roll.result;

  return (
    <div className="DieRoller-display">
      {/* Explicitly sized (className, not left to the motion.div's own
          default auto/shrink-to-fit width) — DieRoller-face's own
          width:55% below is a PERCENTAGE, which needs a definite-width
          containing block to resolve against. Without this class, this
          motion.div has no definite width of its own (its only child is
          itself percentage-sized), so the percentage collapsed toward 0
          instead of 55% of the real, pixel-sized reveal zone — this was
          the "die is now only a few pixels" bug. */}
      <motion.div
        className="DieRoller-displayInner"
        key={rolling ? `${roll.rollId}-${tickIndex}` : `${roll.rollId}-result`}
        initial={{ scale: 0.7, rotate: -12, opacity: 0.6 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ duration: rolling ? 0.08 : 0.3, ease: 'easeOut' }}
      >
        <DieFace value={displayValue} />
      </motion.div>
    </div>
  );
}
