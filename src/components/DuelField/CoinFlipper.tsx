import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { CoinFlipData } from '../Matchmaking/useMultiplayerDuel';
import coinIcon from '../../assets/ui/duelfield/coin.png';
import headsImg from '../../assets/ui/duelfield/heads.png';
import tailsImg from '../../assets/ui/duelfield/tails.png';
import './CoinFlipper.css';

// Same reasoning as DieRoller's own ROLL_DURATION_MS/ROLL_TICK_MS — how
// long the "spinning" animation runs before settling on the real, final
// result, and how often it swaps to a new face during that time.
// Exported so MultiplayerDuelFieldPage's own handleFlipCoin can delay
// its "[Player]'s coin landed on [result]" chat announcement until the
// animation here has actually finished, rather than posting the result
// to chat text the instant the flip starts (which would spoil the whole
// point of watching it spin first) — kept as one shared constant so the
// two can never drift out of sync with each other.
export const FLIP_DURATION_MS = 900;
const FLIP_TICK_MS = 80;

const FACE_IMAGES: Record<'heads' | 'tails', string> = {
  heads: headsImg,
  tails: tailsImg,
};

function CoinFace({ value }: { value: 'heads' | 'tails' }) {
  return <img src={FACE_IMAGES[value]} alt={value} className="CoinFlipper-face" />;
}

// Re-exported so call sites that only ever touch this module (never the
// hook directly) can still import the type from here — the canonical
// declaration lives in useMultiplayerDuel.ts, alongside DuelDoc's own
// player1CoinFlip/player2CoinFlip fields it describes.
export type { CoinFlipData };

interface CoinFlipButtonProps {
  // Only used to disable the button for as long as a flip started from
  // THIS side is currently showing (mid-spin, or settled but not yet
  // auto-cleared) — same convention as DieRollButton's own roll prop.
  // This button never renders the spin/result itself (see
  // CoinFlipDisplay below, which is what players actually watch).
  flip: CoinFlipData | null;
  onFlip: () => void;
}

// The clickable trigger placed on the board, directly beneath
// DieRollButton in the same deckRow slot (see DuelField's own deckRow)
// — always shows the same static coin icon, in every state. Where the
// flip is actually SEEN is CoinFlipDisplay below, shared and centered
// for both players via the reveal zone, so this button's only job is
// starting a flip (and refusing to start a second one while its own is
// still being shown).
export function CoinFlipButton({ flip, onFlip }: CoinFlipButtonProps) {
  return (
    <button
      type="button"
      className="CoinFlipper-button"
      onClick={onFlip}
      disabled={flip !== null}
      title="Flip a coin"
    >
      <img src={coinIcon} alt="Flip a coin" className="CoinFlipper-buttonIcon" />
    </button>
  );
}

interface CoinFlipDisplayProps {
  // The flip currently being shown — shared/synced (DuelDoc's own
  // player1CoinFlip/player2CoinFlip, via useMultiplayerDuel's own
  // myCoinFlip/opponentCoinFlip) rather than local component state, so
  // BOTH clients animate the exact same spin and settle on the exact
  // same result at the exact same time — same reasoning as DieRollData.
  flip: CoinFlipData;
}

// The actual spinning/settled coin face — rendered once, centered in
// the shared reveal zone (see MultiplayerDuelFieldPage's own
// boardStage/activeDieRoll — the coin shares that same slot), identical
// for both players. Purely a display: no button, no onFlip, nothing
// clickable.
export function CoinFlipDisplay({ flip }: CoinFlipDisplayProps) {
  // Ticks this component every FLIP_TICK_MS for as long as the current
  // flip is still mid-animation — purely to force a re-render so the
  // elapsed-time math below picks up the passage of time; the actual
  // "what face/result to show right now" is always freshly recomputed
  // from flip.startedAt at render time, never stored in this state
  // itself. Restarts cleanly whenever flip.flipId changes (a new flip
  // starting), and stops on its own once the current one has settled.
  const [, setTick] = useState(0);
  useEffect(() => {
    const elapsed = () => Date.now() - flip.startedAt;
    if (elapsed() >= FLIP_DURATION_MS) return;
    const intervalId = window.setInterval(() => {
      setTick((n) => n + 1);
      if (elapsed() >= FLIP_DURATION_MS) window.clearInterval(intervalId);
    }, FLIP_TICK_MS);
    return () => window.clearInterval(intervalId);
  }, [flip.flipId, flip.startedAt]);

  const elapsed = Date.now() - flip.startedAt;
  const flipping = elapsed < FLIP_DURATION_MS;
  const tickIndex = Math.floor(elapsed / FLIP_TICK_MS);
  // Alternates every tick during the spin, rather than picking a fresh
  // random face like the die's own tumble does — a coin only has two
  // faces, so a genuinely random pick would visibly "stick" on the same
  // face for consecutive ticks roughly half the time, which reads as
  // stuttering rather than spinning. Strictly alternating always looks
  // like a coin turning over, regardless of what it's about to land on.
  const displayValue: 'heads' | 'tails' = flipping
    ? tickIndex % 2 === 0
      ? 'heads'
      : 'tails'
    : flip.result;

  return (
    <div className="CoinFlipper-display">
      <motion.div
        className="CoinFlipper-displayInner"
        key={flipping ? `${flip.flipId}-${tickIndex}` : `${flip.flipId}-result`}
        // A quick horizontal squash-and-recover on every face swap is
        // what actually sells "spinning" for a flat two-image coin
        // (there's no real 3D flip to animate) — each new face briefly
        // appears edge-on (scaleX near 0) and springs back out to full
        // width, over and over while flipping is true.
        initial={{ scaleX: flipping ? 0.15 : 1, opacity: flipping ? 0.85 : 0.6 }}
        animate={{ scaleX: 1, opacity: 1 }}
        transition={{ duration: flipping ? FLIP_TICK_MS / 1000 : 0.3, ease: 'easeOut' }}
      >
        <CoinFace value={displayValue} />
      </motion.div>
    </div>
  );
}
