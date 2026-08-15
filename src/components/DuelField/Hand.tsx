import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import CardImage from '../CardView/CardImage';
import type { CardData } from '../../types/Card';
import type { CardInstance } from '../../types/CardInstance';
import './Hand.css';

const CARD_WIDTH = 813;
const CARD_HEIGHT = 1185;
const SCALE = 0.12;
const CARD_CELL_WIDTH = CARD_WIDTH * SCALE;
const CARD_CELL_HEIGHT = CARD_HEIGHT * SCALE;
const HAND_GAP = 4;
// Beyond this many cards, spacing between cards shrinks (and they start
// overlapping) so the hand's total width stays capped rather than
// growing without bound and overflowing the screen.
const MAX_VISIBLE_CARDS = 6;
const MAX_HAND_WIDTH = MAX_VISIBLE_CARDS * CARD_CELL_WIDTH + (MAX_VISIBLE_CARDS - 1) * HAND_GAP;
// How far a card rises when hovered.
const HOVER_LIFT_Y = 40;

// How long to wait before actually hiding the menu after the cursor
// leaves. Without this, the menu (which only renders while hovered)
// unmounts the instant the cursor crosses the small visual gap between
// the card and the menu above it — before it can ever reach the menu.
const MENU_HIDE_DELAY_MS = 150;

interface HandAction {
  key: string;
  label: string;
}

// Which actions are available for a given card. Class-specific ones
// (Normal Summon, Activate, Set) come first, followed by the universal
// ones every card gets regardless of class — structured as a list
// (rather than separate flags) so more actions can be added here later
// without changing how the menu itself renders.
function getHandActions(card: CardData): HandAction[] {
  const actions: HandAction[] = [];

  const isNormalOrEffectMonster =
    card.cardClass === 'Monster' &&
    (card.cardSubclass === 'Normal' || card.cardSubclass === 'Effect');

  if (isNormalOrEffectMonster) {
    actions.push({ key: 'normalSummon', label: 'N. Summon' });
  }

  if (card.cardClass === 'Spell') {
    actions.push({ key: 'activate', label: 'Activate' }, { key: 'set', label: 'Set' });
  }

  if (card.cardClass === 'Trap') {
    actions.push({ key: 'set', label: 'Set' });
  }

  actions.push(
    { key: 'toGrave', label: 'To Grave' },
    { key: 'banish', label: 'Banish' },
    { key: 'stackTop', label: 'To T. Deck' },
    { key: 'stackBottom', label: 'To B. Deck' },
  );

  return actions;
}

interface HandProps {
  cards: CardInstance[];
  // Per-instanceId starting rotation (in degrees) for a card's very
  // first frame in Hand — used so a card returning from Defense
  // Position on the field can visually unwind smoothly back to upright
  // while it moves, rather than snapping straight. See DuelFieldPage's
  // handEntryRotations for where this gets populated. Cards with no
  // entry here (e.g. freshly drawn) just start upright, matching the
  // animate target, so nothing visibly animates for them.
  entryRotations?: Record<string, number>;
  // Same idea, for cards returning to Hand face-down — true means this
  // card's very first frame in Hand should start "edge-on" (scaleX: 0)
  // and unfurl into its face, mirroring the flip-reveal used when a
  // card is Set on the field. See DuelFieldPage's handEntryFlips.
  entryFlips?: Record<string, boolean>;
  onCardHover?: (card: CardData) => void;
  onCardHoverEnd?: () => void;
  onNormalSummon: (instanceId: string) => void;
  onActivateSpell: (instanceId: string) => void;
  onSetSpellOrTrap: (instanceId: string) => void;
  onToGrave: (instanceId: string) => void;
  onBanish: (instanceId: string) => void;
  onStackTop: (instanceId: string) => void;
  onStackBottom: (instanceId: string) => void;
  // True for the whole duration of a hand shuffle (piling, the reorder
  // itself, and spreading back out) — see DuelFieldPage's isHandPiled.
  // While true, every card animates to the same central "pile" position
  // instead of its normal spread-out one, and hover/click interaction is
  // disabled so nothing can be selected mid-shuffle.
  piled?: boolean;
  onShuffleHand?: () => void;
  // Separately from `piled` (which reflects the shuffle animation
  // itself) — true while some other reason makes shuffling not currently
  // valid, e.g. the opening hand still being dealt. Keeps the button
  // rendered (so it doesn't pop in/out) but visibly disabled instead.
  shuffleDisabled?: boolean;
}

function Hand({
  cards,
  entryRotations,
  entryFlips,
  onCardHover,
  onCardHoverEnd,
  onNormalSummon,
  onActivateSpell,
  onSetSpellOrTrap,
  onToGrave,
  onBanish,
  onStackTop,
  onStackBottom,
  piled = false,
  onShuffleHand,
  shuffleDisabled = false,
}: HandProps) {
  // Which hand card (by instanceId) currently shows its context menu —
  // a separate concern from the CardDisplay hover callbacks above,
  // though both are driven by the same mouseenter/mouseleave.
  const [hoveredInstanceId, setHoveredInstanceId] = useState<string | null>(null);
  const hideTimeoutRef = useRef<number | undefined>(undefined);

  const cancelHide = () => {
    if (hideTimeoutRef.current !== undefined) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = undefined;
    }
  };

  const scheduleHide = (instanceId: string) => {
    cancelHide();
    hideTimeoutRef.current = window.setTimeout(() => {
      setHoveredInstanceId((current) => (current === instanceId ? null : current));
    }, MENU_HIDE_DELAY_MS);
  };

  useEffect(() => () => cancelHide(), []);

  // Guards against a leftover hover state (e.g. the cursor was still
  // over a card the instant "Shuffle Hand" was clicked) leaving a
  // context menu visibly stuck open through the pile animation, even
  // though hover is disabled for the cards themselves once piled.
  useEffect(() => {
    if (piled) {
      cancelHide();
      setHoveredInstanceId(null);
    }
  }, [piled]);

  const handleAction = (instanceId: string, actionKey: string) => {
    cancelHide();
    switch (actionKey) {
      case 'normalSummon':
        onNormalSummon(instanceId);
        break;
      case 'activate':
        onActivateSpell(instanceId);
        break;
      case 'set':
        onSetSpellOrTrap(instanceId);
        break;
      case 'toGrave':
        onToGrave(instanceId);
        break;
      case 'banish':
        onBanish(instanceId);
        break;
      case 'stackTop':
        onStackTop(instanceId);
        break;
      case 'stackBottom':
        onStackBottom(instanceId);
        break;
    }
    setHoveredInstanceId(null);
  };

  // Normal spacing (card width + gap) up to MAX_VISIBLE_CARDS; beyond
  // that, spacing shrinks so (n-1) advances plus one card width always
  // equals MAX_HAND_WIDTH exactly, however many cards there are.
  const n = cards.length;
  const normalAdvance = CARD_CELL_WIDTH + HAND_GAP;
  const advance =
    n <= 1 || n <= MAX_VISIBLE_CARDS
      ? normalAdvance
      : (MAX_HAND_WIDTH - CARD_CELL_WIDTH) / (n - 1);
  const handWidth = n === 0 ? 0 : (n - 1) * advance + CARD_CELL_WIDTH;
  // Where every card converges to while piled — horizontally centered
  // within the hand's own (unchanged) bounding box, so the pile forms
  // and later spreads back out from the same fixed footprint rather than
  // the whole hand shifting or resizing around it.
  const pileLeft = (handWidth - CARD_CELL_WIDTH) / 2;

  return (
    <div className="Hand" style={{ width: handWidth, height: CARD_CELL_HEIGHT }}>
      {cards.map(({ instanceId, card }, index) => {
        const actions = getHandActions(card);
        const showMenu = hoveredInstanceId === instanceId && actions.length > 0;

        return (
          <motion.div
            key={instanceId}
            layoutId={instanceId}
            // y is framer-motion's own tracked motion value (not a raw
            // CSS transform string), so — unlike the Defense Position
            // rotation issue elsewhere in this app — it composes
            // correctly with the layoutId-driven layout animation on
            // this same element rather than fighting it.
            animate={{ y: hoveredInstanceId === instanceId ? -HOVER_LIFT_Y : 0 }}
            // Split per-property so the pile/spread movement (driven by
            // `left` below, picked up automatically as a layout
            // animation) can run slower and more deliberately than the
            // snappy hover-lift, without the two fighting over one
            // shared duration.
            transition={{
              y: { duration: 0.1, ease: 'easeInOut' },
              layout: { duration: 0.35, ease: 'easeInOut' },
            }}
            className="Hand-cell"
            style={{
              width: CARD_CELL_WIDTH,
              height: CARD_CELL_HEIGHT,
              left: piled ? pileLeft : index * advance,
              // Overlapping cards otherwise stack purely by DOM order
              // (later card on top) — this lets the hovered card rise
              // above whichever neighbors currently cover part of it,
              // regardless of its own position in that order. While
              // piled, hover is disabled (see below) so this just falls
              // back to plain index order — meaning the last card in the
              // (possibly just-reordered) array is always the one
              // visible on top of the pile.
              zIndex: !piled && hoveredInstanceId === instanceId ? cards.length + 1 : index,
            }}
            onMouseEnter={
              piled
                ? undefined
                : () => {
                    cancelHide();
                    setHoveredInstanceId(instanceId);
                    onCardHover?.(card);
                  }
            }
            onMouseLeave={
              piled
                ? undefined
                : () => {
                    scheduleHide(instanceId);
                    onCardHoverEnd?.();
                  }
            }
          >
            <AnimatePresence>
              {showMenu && (
                <motion.div
                  className="Hand-contextMenu"
                  initial={{ opacity: 0, x: '-50%', y: 10 }}
                  animate={{ opacity: 1, x: '-50%', y: 0 }}
                  exit={{ opacity: 0, x: '-50%', y: 10 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                >
                  {actions.map((action) => (
                    <button
                      key={action.key}
                      type="button"
                      className="Hand-contextMenuButton"
                      onClick={() => handleAction(instanceId, action.key)}
                    >
                      {action.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
            <motion.div
              className="Hand-cardRotation"
              style={{ width: '100%', height: '100%' }}
              initial={{ rotate: entryRotations?.[instanceId] ?? 0 }}
              animate={{ rotate: 0 }}
              transition={{ duration: 0.1, ease: 'easeInOut' }}
            >
              <motion.div
                className="Hand-flipReveal"
                initial={{ scaleX: entryFlips?.[instanceId] ? 0 : 1 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.1, ease: 'easeInOut' }}
              >
                <div
                  className="Hand-cardWrapper"
                  style={{
                    width: CARD_WIDTH,
                    height: CARD_HEIGHT,
                    transform: `scale(${SCALE})`,
                  }}
                >
                  <CardImage card={card} />
                </div>
              </motion.div>
            </motion.div>
          </motion.div>
        );
      })}
      {onShuffleHand && (
        <button
          type="button"
          className="Hand-shuffleButton"
          onClick={onShuffleHand}
          disabled={piled || cards.length < 2 || shuffleDisabled}
        >
          Shuffle Hand
        </button>
      )}
    </div>
  );
}

export default Hand;