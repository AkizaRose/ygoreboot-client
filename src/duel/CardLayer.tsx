import { useEffect, useRef, useState } from 'react';
import {
  motion,
  useMotionValue,
  useTransform,
} from 'framer-motion';
import type { CardPositionEntry } from './cardPositions';
import type { OpponentDuelState } from '../components/Matchmaking/useMultiplayerDuel';
import type { CardInstance } from '../types/CardInstance';
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

interface CardVisualPosition {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  faceDown: boolean;
}

interface ReturningOpponentCard {
  id: string;
  card: CardInstance['card'];
  from: CardVisualPosition;
  to: CardVisualPosition;
  zIndex: number;
}

interface HiddenSource extends CardVisualPosition {}

// The visible opponent hand is intentionally kept as a separate, simple row
// because its actual card identities are private. These coordinates mirror
// the current opponent-hand styling in MultiplayerDuelFieldPage.css.
const OPPONENT_HAND_TOP = -130;

function containsOpponentInstance(
  opponent: OpponentDuelState,
  instanceId: string,
): boolean {
  const containsPlaced = (
    placed: { instanceId: string; stackedBelow?: { instanceId: string }[] } | null,
  ) =>
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

  // Hand -> public zone: the exact hand position is private, so use the last
  // visible hand position as the best available visual source.
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

function AnimatedCard({
  entry,
  hiddenSource = null,
  startOverride = null,
  onAnimationComplete,
  animationDuration = 0.3,
}: {
  entry: CardPositionEntry;
  hiddenSource?: HiddenSource | null;
  startOverride?: CardVisualPosition | null;
  onAnimationComplete?: () => void;
  animationDuration?: number;
}) {
  const targetRotationY = entry.faceDown ? 180 : 0;
  const initialRotationY = startOverride?.faceDown
    ? 180
    : hiddenSource?.faceDown
      ? 180
      : targetRotationY;
  const rotationY = useMotionValue(initialRotationY);

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

  const initialPosition = startOverride ?? hiddenSource;
  const initialAnimation = initialPosition
    ? {
        x: initialPosition.x,
        y: initialPosition.y,
        width: CARD_NATIVE_WIDTH * initialPosition.scale,
        height: CARD_NATIVE_HEIGHT * initialPosition.scale,
        rotate: initialPosition.rotation,
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
        x: { duration: animationDuration, ease: 'easeInOut' },
        y: { duration: animationDuration, ease: 'easeInOut' },
        width: { duration: animationDuration, ease: 'easeInOut' },
        height: { duration: animationDuration, ease: 'easeInOut' },
        rotate: { duration: animationDuration, ease: 'easeInOut' },
      }}
      onAnimationComplete={onAnimationComplete}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        zIndex: entry.zIndex,
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          perspective: 1000,
        }}
      >
        <motion.div
          initial={{ rotateY: initialRotationY }}
          animate={{ rotateY: targetRotationY }}
          transition={{ duration: animationDuration, ease: 'easeInOut' }}
          onUpdate={(latest) => {
            if (typeof latest.rotateY === 'number') {
              rotationY.set(latest.rotateY);
            }
          }}
          style={{
            width: '100%',
            height: '100%',
            position: 'relative',
            transformStyle: 'preserve-3d',
            transformOrigin: 'center center',
          }}
        >
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

function CardLayer({ entries, opponent = null }: CardLayerProps) {
  const previousOpponentRef = useRef<OpponentDuelState | null>(null);
  const previousEntriesRef = useRef<CardPositionEntry[]>([]);
  const [returningCards, setReturningCards] = useState<ReturningOpponentCard[]>([]);
  const previousOpponent = previousOpponentRef.current;
  const previousEntries = previousEntriesRef.current;

  useEffect(() => {
    if (previousOpponent && opponent && opponent.handCount > previousOpponent.handCount) {
      const currentIds = new Set(entries.map((entry) => entry.instanceId));
      const previousPublicOpponentIds = new Set<string>();
      const currentPublicOpponentIds = new Set<string>();

      for (const entry of previousEntries) {
        if (containsOpponentInstance(previousOpponent, entry.instanceId)) {
          previousPublicOpponentIds.add(entry.instanceId);
        }
      }

      for (const entry of entries) {
        if (containsOpponentInstance(opponent, entry.instanceId)) {
          currentPublicOpponentIds.add(entry.instanceId);
        }
      }

      const disappeared = [...previousPublicOpponentIds].filter(
        (id) => !currentPublicOpponentIds.has(id) && !currentIds.has(id),
      );

      if (disappeared.length > 0) {
        const handCount = opponent.handCount;
        const firstNewHandIndex = previousOpponent.handCount;
        const newReturningCards = disappeared
          .map((id, offset) => {
            const fromEntry = previousEntries.find((entry) => entry.instanceId === id);
            if (!fromEntry) return null;

            const targetSlot = getHandSlot(
              handCount,
              Math.min(handCount - 1, firstNewHandIndex + offset),
            );

            const from: CardVisualPosition = {
              x: fromEntry.x,
              y: fromEntry.y,
              scale: fromEntry.scale,
              rotation: fromEntry.rotation,
              faceDown: fromEntry.faceDown,
            };
            const to: CardVisualPosition = {
              x: targetSlot.x,
              y: OPPONENT_HAND_TOP,
              scale: targetSlot.width / CARD_NATIVE_WIDTH,
              rotation: 180,
              faceDown: true,
            };

            return {
              id,
              card: fromEntry.card,
              from,
              to,
              zIndex: 320 + offset,
            };
          })
          .filter((card): card is ReturningOpponentCard => card !== null);

        if (newReturningCards.length > 0) {
          setReturningCards((current) => [...current, ...newReturningCards]);
        }
      }
    }

    previousOpponentRef.current = opponent;
    previousEntriesRef.current = entries;
  }, [entries, opponent, previousEntries, previousOpponent]);

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {entries.map((entry) => (
        <AnimatedCard
          key={entry.instanceId}
          entry={entry}
          hiddenSource={getHiddenSource(entry, previousOpponent, opponent)}
        />
      ))}

      {returningCards.map((card) => {
        const returningEntry: CardPositionEntry = {
          instanceId: card.id,
          card: card.card,
          x: card.to.x,
          y: card.to.y,
          rotation: card.to.rotation,
          scale: card.to.scale,
          faceDown: true,
          zIndex: card.zIndex,
        };

        return (
          <AnimatedCard
            key={`returning-${card.id}`}
            entry={returningEntry}
            startOverride={card.from}
            animationDuration={0.45}
            onAnimationComplete={() => {
              setReturningCards((current) => current.filter((item) => item.id !== card.id));
            }}
          />
        );
      })}
    </div>
  );
}

export default CardLayer;
