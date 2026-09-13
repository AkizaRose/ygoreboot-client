import { useEffect, useRef } from 'react';
import {
  motion,
  useMotionValue,
  useTransform,
  animate,
} from 'framer-motion';
import type { CardPositionEntry } from './cardPositions';
import type { OpponentDuelState } from '../components/Matchmaking/useMultiplayerDuel';
import CardImage from '../components/CardView/CardImage';
import cardBackImg from '../assets/card/CardBack.png';
import {
  CARD_NATIVE_WIDTH,
  CARD_NATIVE_HEIGHT,
  FIELD_CARD_SCALE,
  getDeckZoneSlot,
  getHandSlot,
} from './cardGeometry';

interface CardLayerProps {
  entries: CardPositionEntry[];
  opponent?: OpponentDuelState | null;
}

interface HiddenSource {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  faceDown: boolean;
}

// The visible opponent hand is intentionally kept as a separate, simple row
// because its actual card identities are private. These coordinates mirror
// the current opponent-hand styling in MultiplayerDuelFieldPage.css. The
// important part is that a hidden-source card starts from the same board-space
// area as the visible opponent hand and then travels into its public
// destination.
const OPPONENT_HAND_TOP = -130;

function containsOpponentInstance(opponent: OpponentDuelState, instanceId: string): boolean {
  const containsPlaced = (placed: { instanceId: string; stackedBelow?: { instanceId: string }[] } | null) =>
    placed?.instanceId === instanceId ||
    placed?.stackedBelow?.some((card) => card.instanceId === instanceId) === true;

  const containsPile = (pile: { instanceId: string }[]) =>
    pile.some((card) => card.instanceId === instanceId);

  return (
    opponent.monsterZones.some(containsPlaced) ||
    opponent.spellTrapZones.some(containsPlaced) ||
    containsPlaced(opponent.fieldZone) ||
    containsPile(opponent.grave) ||
    containsPile(opponent.banished)
  );
}

function getHiddenSource(
  entry: CardPositionEntry,
  previousOpponent: OpponentDuelState | null,
  opponent: OpponentDuelState | null,
): HiddenSource | null {
  if (!previousOpponent || !opponent) return null;

  // Synthetic opponent deck/hand proxy entries are deliberately not treated
  // as real physical cards. A real public instanceId appearing for the first
  // time is the case we are interested in here.
  if (entry.instanceId.startsWith('opponent-')) return null;
  if (containsOpponentInstance(previousOpponent, entry.instanceId)) return null;

  // Hand -> public zone: the real hand position is intentionally hidden, but
  // we know its current visual row and use the last card as the conservative
  // source position. Which exact hidden card was used is not public data.
  if (opponent.handCount < previousOpponent.handCount) {
    const sourceIndex = Math.max(0, previousOpponent.handCount - 1);
    const sourceSlot = getHandSlot(previousOpponent.handCount, sourceIndex);
    return {
      x: sourceSlot.x,
      y: OPPONENT_HAND_TOP,
      scale: sourceSlot.width / CARD_NATIVE_WIDTH,
      rotation: 180,
      faceDown: true,
    };
  }

  // Main Deck -> public zone. The exact card is intentionally unknown, but
  // the pile's board-space origin is public and stable.
  if (opponent.mainDeckCount < previousOpponent.mainDeckCount) {
    const sourceSlot = getDeckZoneSlot(true, 'main');
    return {
      x: sourceSlot.x,
      y: sourceSlot.y,
      scale: FIELD_CARD_SCALE,
      rotation: 180,
      faceDown: true,
    };
  }

  // Extra Deck -> public zone uses the same principle as Main Deck.
  if (opponent.extraDeckCount < previousOpponent.extraDeckCount) {
    const sourceSlot = getDeckZoneSlot(true, 'extra');
    return {
      x: sourceSlot.x,
      y: sourceSlot.y,
      scale: FIELD_CARD_SCALE,
      rotation: 180,
      faceDown: true,
    };
  }

  return null;
}

// TEMPORARY DIAGNOSTIC — remove once the animation work is confirmed fixed.
function MountLogger({ instanceId }: { instanceId: string }) {
  useEffect(() => {
    console.log(`[CardLayer] mounted: ${instanceId}`);
    return () => console.log(`[CardLayer] unmounted: ${instanceId}`);
  }, [instanceId]);
  return null;
}

// A card can be both moving and changing between face-up and face-down.
// Position/size/board rotation therefore live on the outer motion element,
// while the 3D card flip lives on a nested element.
function AnimatedCard({ entry, hiddenSource }: { entry: CardPositionEntry; hiddenSource: HiddenSource | null }) {
  const targetRotationY = entry.faceDown ? 180 : 0;
  const initialRotationY = hiddenSource?.faceDown ? 180 : targetRotationY;
  const rotationY = useMotionValue(initialRotationY);

  useEffect(() => {
    const controls = animate(rotationY, targetRotationY, {
      duration: 0.3,
      ease: 'easeInOut',
    });

    return () => controls.stop();
  }, [rotationY, targetRotationY]);

  // Only one face is allowed to contribute visible pixels at a time. The
  // tiny edge-on interval avoids the front and back visually blending.
  const frontOpacity = useTransform(
    rotationY,
    [0, 88, 92, 180],
    [1, 1, 0, 0],
  );
  const backOpacity = useTransform(
    rotationY,
    [0, 88, 92, 180],
    [0, 0, 1, 1],
  );

  const displayWidth = CARD_NATIVE_WIDTH * entry.scale;
  const displayHeight = CARD_NATIVE_HEIGHT * entry.scale;

  const initialAnimation = hiddenSource
    ? {
        x: hiddenSource.x,
        y: hiddenSource.y,
        width: CARD_NATIVE_WIDTH * hiddenSource.scale,
        height: CARD_NATIVE_HEIGHT * hiddenSource.scale,
        rotate: hiddenSource.rotation,
      }
    : false;

  return (
    <motion.div
      initial={initialAnimation}
      animate={{
        x: entry.x,
        y: entry.y,
        width: displayWidth,
        height: displayHeight,
        rotate: entry.rotation,
      }}
      transition={{
        x: { duration: 0.3, ease: 'easeInOut' },
        y: { duration: 0.3, ease: 'easeInOut' },
        width: { duration: 0.3, ease: 'easeInOut' },
        height: { duration: 0.3, ease: 'easeInOut' },
        rotate: { duration: 0.3, ease: 'easeInOut' },
      }}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        zIndex: entry.zIndex,
      }}
    >
      <MountLogger instanceId={entry.instanceId} />

      <div
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          perspective: 1000,
        }}
      >
        <motion.div
          style={{
            width: '100%',
            height: '100%',
            position: 'relative',
            rotateY: rotationY,
            transformStyle: 'preserve-3d',
            transformOrigin: 'center center',
          }}
        >
          {/* Front face */}
          <motion.div
            style={{
              position: 'absolute',
              inset: 0,
              opacity: frontOpacity,
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
            }}
          >
            <div
              style={{
                width: CARD_NATIVE_WIDTH,
                height: CARD_NATIVE_HEIGHT,
                transform: `scale(${entry.scale})`,
                transformOrigin: 'top left',
              }}
            >
              {entry.card ? <CardImage card={entry.card} /> : null}
            </div>
          </motion.div>

          {/* Back face */}
          <motion.div
            style={{
              position: 'absolute',
              inset: 0,
              opacity: backOpacity,
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
            }}
          >
            <div
              style={{
                width: CARD_NATIVE_WIDTH,
                height: CARD_NATIVE_HEIGHT,
                transform: `scale(${entry.scale})`,
                transformOrigin: 'top left',
              }}
            >
              <img
                src={cardBackImg}
                alt=""
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: 'block',
                }}
              />
            </div>
          </motion.div>
        </motion.div>
      </div>
    </motion.div>
  );
}

// One persistent visual element per physical card. Visible-zone moves retain
// their real instanceId, while a card arriving from a hidden opponent zone
// receives a one-time inferred starting position and face-down state.
function CardLayer({ entries, opponent = null }: CardLayerProps) {
  const previousOpponentRef = useRef<OpponentDuelState | null>(null);
  const previousOpponent = previousOpponentRef.current;

  useEffect(() => {
    previousOpponentRef.current = opponent;
  }, [opponent]);

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {entries.map((entry) => (
        <AnimatedCard
          key={entry.instanceId}
          entry={entry}
          hiddenSource={getHiddenSource(entry, previousOpponent, opponent)}
        />
      ))}
    </div>
  );
}

export default CardLayer;
