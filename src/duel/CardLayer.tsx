import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  motion,
  useMotionValue,
  useTransform,
} from 'framer-motion';
import type { CardPositionEntry } from './cardPositions';
import type {
  MyDuelState,
  OpponentDuelState,
  PlayerRole,
} from '../components/Matchmaking/useMultiplayerDuel';
import { encodeHandSelection, decodeHandSelection } from '../components/Matchmaking/useMultiplayerDuel';
import type { CardInstance } from '../types/CardInstance';
import CardImage from '../components/CardView/CardImage';
import cardBackImg from '../assets/card/CardBack.png';
import {
  CARD_NATIVE_WIDTH,
  CARD_NATIVE_HEIGHT,
  FIELD_CARD_SCALE,
  HAND_CARD_SCALE,
  BOARD_WIDTH,
  OPPONENT_HAND_TOP,
  getDeckZoneSlot,
  getHandSlot,
  getOpponentHandSlot,
} from './cardGeometry';

interface CardLayerProps {
  entries: CardPositionEntry[];
  me?: MyDuelState | null;
  opponent?: OpponentDuelState | null;
  // This client's own role — needed to tell whether a decoded hand
  // selection (see decodeHandSelection) refers to this player's own
  // hand or the opponent's, which determines how it's matched against
  // rendered entries (see getSelectionColor below).
  myRole?: PlayerRole | null;
  mySelection?: string | null;
  opponentSelection?: string | null;
  // Only ever actually invoked for the opponent's hand proxies — every
  // other selectable card is clicked through its own FieldZone instead
  // (see DuelField.tsx), since those already coexist correctly with
  // hover-menus and other zone interactions. The opponent's hand has no
  // FieldZone underneath it to hook into at all, so it's the one place
  // this gets wired up directly here.
  onSelectCard?: (target: string) => void;
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

// A card mid-shuffle: converges from its own old slot to the hand's
// shared center point, then (after a brief hold, stacked with every
// other card in the same shuffle) fans back out to its new slot.
interface ShufflingCard {
  id: string;
  card: CardInstance['card'] | null;
  from: CardVisualPosition;
  via: CardVisualPosition;
  to: CardVisualPosition;
  zIndex: number;
}

interface HiddenSource extends CardVisualPosition {}

// Resolves whether a given rendered entry matches either player's
// current selection, and if so, whose. A plain selection value is a
// real field-card instanceId — direct comparison. An encoded hand
// selection ("hand:<owner>:<index>", see decodeHandSelection) needs
// different handling depending on whose hand it refers to: if it's
// THIS client's own hand, the selection is positional (the other
// player has no way to reference a real instanceId for a hand card
// they can't see), so it's matched by looking up me.hand[index] and
// comparing THAT card's real instanceId — but if it's the OPPONENT's
// hand, the entry being rendered already IS the position-only proxy
// (opponent-hand-N), so the encoded index is compared directly against
// that same naming instead.
function getSelectionColor(
  entryInstanceId: string,
  mySelection: string | null,
  opponentSelection: string | null,
  me: MyDuelState | null,
  myRole: PlayerRole | null,
  opponentRole: PlayerRole | null,
): 'mine' | 'opponent' | null {
  const matches = (selection: string | null): boolean => {
    if (!selection) return false;
    const decoded = decodeHandSelection(selection);
    if (decoded) {
      if (decoded.owner === myRole) {
        return me?.hand[decoded.index]?.instanceId === entryInstanceId;
      }
      if (decoded.owner === opponentRole) {
        return entryInstanceId === `opponent-hand-${decoded.index}`;
      }
      return false;
    }
    return entryInstanceId === selection;
  };

  if (matches(mySelection)) return 'mine';
  if (matches(opponentSelection)) return 'opponent';
  return null;
}

// Both hands are horizontally centered at BOARD_WIDTH/2 — getHandSlot's
// own centering math (handLeft + handWidth/2) always resolves to exactly
// that point, for either hand, regardless of how many cards are in it.
// This is the x every card in a shuffle converges toward; only the y
// differs (the player's own hand row vs OPPONENT_HAND_TOP).
const HAND_CENTER_X = BOARD_WIDTH / 2 - (CARD_NATIVE_WIDTH * HAND_CARD_SCALE) / 2;

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

  // Hand -> public zone: opponent.lastHandDepartureIndex is set by the
  // DEPARTING player's own client (see MultiplayerDuelFieldPage's
  // applyMeUpdate), recording which slot the card was actually at right
  // before it left — this is what replaces the old fixed "assume it was
  // the last slot" guess with the real position. Read from `opponent`
  // (the current snapshot), not `previousOpponent` — the new value
  // arrives as part of the SAME write that also drops handCount, so
  // previousOpponent would only ever have last update's (or no) value.
  // Falls back to the old guess only if the index is somehow
  // unavailable (a duel that started before this field existed).
  if (opponent.handCount < previousOpponent.handCount) {
    const sourceIndex =
      opponent.lastHandDepartureIndex ?? Math.max(0, previousOpponent.handCount - 1);
    const sourceSlot = getOpponentHandSlot(previousOpponent.handCount, sourceIndex);
    return {
      x: sourceSlot.x,
      y: sourceSlot.y,
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
  viaOverride = null,
  onAnimationComplete,
  animationDuration = 0.3,
  coordinateOffset = null,
  selectionColor = null,
  onClick,
}: {
  entry: CardPositionEntry;
  hiddenSource?: HiddenSource | null;
  startOverride?: CardVisualPosition | null;
  // An intermediate waypoint between the start and the target — used for
  // the hand-shuffle animation (converge to the hand's center, hold
  // briefly, then fan back out), see ShufflingCard/handleShuffle below.
  // null for every other animation, which just goes straight from start
  // to target as before.
  viaOverride?: CardVisualPosition | null;
  onAnimationComplete?: () => void;
  animationDuration?: number;
  coordinateOffset?: { x: number; y: number } | null;
  // 'mine' (red) or 'opponent' (blue) — see getSelectionColor. Purely
  // visual; rendered with pointer-events:none regardless of onClick
  // below, so the outline itself never blocks a click reaching whatever
  // it's layered on top of.
  selectionColor?: 'mine' | 'opponent' | null;
  // Only ever passed for the opponent's hand proxies (see CardLayer's
  // own render loop) — everywhere else, selecting a card is handled by
  // that card's own FieldZone instead, not here.
  onClick?: () => void;
}) {
  const targetRotationY = entry.faceDown ? 180 : 0;
  // Reflects whichever source's ACTUAL faceDown value applies — not just
  // "if true, 180, else fall through further" (which is what this used
  // to do, and why a card returning from face-up on the field to the
  // opponent's hand never animated: startOverride.faceDown is false
  // there, so the old logic fell all the way through to targetRotationY
  // instead of landing on 0, making the start and end values identical
  // before the animation even had anything to interpolate between).
  const initialRotationY =
    startOverride !== null
      ? startOverride.faceDown
        ? 180
        : 0
      : hiddenSource !== null
        ? hiddenSource.faceDown
          ? 180
          : 0
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
  const offsetX = coordinateOffset?.x ?? 0;
  const offsetY = coordinateOffset?.y ?? 0;

  const initialPosition = startOverride ?? hiddenSource;
  const initialAnimation = initialPosition
    ? {
        x: initialPosition.x + offsetX,
        y: initialPosition.y + offsetY,
        width: CARD_NATIVE_WIDTH * initialPosition.scale,
        height: CARD_NATIVE_HEIGHT * initialPosition.scale,
        rotate: initialPosition.rotation,
      }
    : false;

  // With a via waypoint: a 3-keyframe sequence per property (reach via,
  // hold at via, then reach the real target) instead of animating
  // straight to the target in one step. The hold is a genuine pause, not
  // an approximation — repeating the same value for two consecutive
  // keyframes means no movement happens between them, which is exactly
  // what "briefly stacked at the center before fanning back out" needs.
  const shuffleStart = initialPosition ?? viaOverride;
  const animateTarget = viaOverride
    ? {
        x: [
          shuffleStart!.x + offsetX,
          viaOverride.x + offsetX,
          viaOverride.x + offsetX,
          entry.x + offsetX,
        ],
        y: [
          shuffleStart!.y + offsetY,
          viaOverride.y + offsetY,
          viaOverride.y + offsetY,
          entry.y + offsetY,
        ],
        width: [
          CARD_NATIVE_WIDTH * shuffleStart!.scale,
          CARD_NATIVE_WIDTH * viaOverride.scale,
          CARD_NATIVE_WIDTH * viaOverride.scale,
          displayWidth,
        ],
        height: [
          CARD_NATIVE_HEIGHT * shuffleStart!.scale,
          CARD_NATIVE_HEIGHT * viaOverride.scale,
          CARD_NATIVE_HEIGHT * viaOverride.scale,
          displayHeight,
        ],
        rotate: [
          shuffleStart!.rotation,
          viaOverride.rotation,
          viaOverride.rotation,
          entry.rotation,
        ],
      }
    : {
        x: entry.x + offsetX,
        y: entry.y + offsetY,
        width: displayWidth,
        height: displayHeight,
        rotate: entry.rotation,
      };
  // times is only meaningful alongside an actual keyframe array — for the
  // plain (non-via) case above, framer-motion ignores it entirely, since
  // there's only one value to reach, not a sequence to schedule.
  const keyframeTimes = viaOverride ? [0, 0.4, 0.6, 1] : undefined;

  return (
    <motion.div
      initial={initialAnimation}
      animate={animateTarget}
      transition={{
        x: { duration: animationDuration, ease: 'easeInOut', times: keyframeTimes },
        y: { duration: animationDuration, ease: 'easeInOut', times: keyframeTimes },
        width: { duration: animationDuration, ease: 'easeInOut', times: keyframeTimes },
        height: { duration: animationDuration, ease: 'easeInOut', times: keyframeTimes },
        rotate: { duration: animationDuration, ease: 'easeInOut', times: keyframeTimes },
      }}
      onAnimationComplete={onAnimationComplete}
      onClick={onClick}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        zIndex: entry.zIndex,
        // Only clickable at all when onClick was actually passed
        // (opponent hand proxies) — every other card stays
        // pointer-events:none here, same as before this feature
        // existed, so it never blocks hover reaching the FieldZone
        // underneath it. That zone's own onClick is what handles
        // selecting for every card except this one case.
        pointerEvents: onClick ? 'auto' : 'none',
        cursor: onClick ? 'pointer' : undefined,
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
      {/* Deliberately a sibling of the perspective wrapper above, not a
          child of it — this sits outside the 3D rotateY transform
          entirely, so the outline itself never flips/mirrors along with
          the card's own face-up/face-down animation; it always reads as
          a flat rectangle traced just inside the card's own edge.
          pointer-events:none unconditionally — purely decorative, never
          a click target itself, and never blocks the click target this
          card might itself be (see onClick above) or whatever's
          underneath it. */}
      {selectionColor && (
        <div
          style={{
            position: 'absolute',
            inset: 3,
            pointerEvents: 'none',
            boxShadow: `inset 0 0 0 3px ${selectionColor === 'mine' ? '#e53935' : '#1e88e5'}`,
            borderRadius: 4,
          }}
        />
      )}
    </motion.div>
  );
}

function CardLayer({
  entries,
  me = null,
  opponent = null,
  myRole = null,
  mySelection = null,
  opponentSelection = null,
  onSelectCard,
}: CardLayerProps) {
  const opponentRole: PlayerRole | null =
    myRole === 'player1' ? 'player2' : myRole === 'player2' ? 'player1' : null;
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [stageOffset, setStageOffset] = useState<{ x: number; y: number } | null>(null);
  const previousOpponentRef = useRef<OpponentDuelState | null>(null);
  const previousEntriesRef = useRef<CardPositionEntry[]>([]);
  const [returningCards, setReturningCards] = useState<ReturningOpponentCard[]>([]);
  const previousOpponent = previousOpponentRef.current;
  const previousEntries = previousEntriesRef.current;

  // CardLayer normally lives inside boardStage and therefore uses board-space
  // coordinates. The opponent hand is deliberately rendered in a viewport
  // layer so the page's bottom-edge clipping cannot accidentally clip the
  // visible part of a hand card. Convert board-space coordinates into viewport
  // coordinates by tracking boardStage's actual viewport origin.
  useLayoutEffect(() => {
    const layer = layerRef.current;
    const stage = layer?.parentElement;
    if (!stage) return;

    const updateOffset = () => {
      const rect = stage.getBoundingClientRect();
      setStageOffset({ x: rect.left, y: rect.top });
    };

    updateOffset();
    window.addEventListener('resize', updateOffset);
    window.addEventListener('scroll', updateOffset, true);

    const observer = new ResizeObserver(updateOffset);
    observer.observe(stage);

    return () => {
      window.removeEventListener('resize', updateOffset);
      window.removeEventListener('scroll', updateOffset, true);
      observer.disconnect();
    };
  }, []);

  // Tracks the last-seen handShuffleVersion for each side, so a shuffle
  // is only ever detected once per actual increment — not on every
  // render, and not (for example) on the very first render, where
  // "previous" is still undefined and there's nothing to compare
  // against yet.
  const previousMeShuffleVersionRef = useRef<number | null>(null);
  const previousOpponentShuffleVersionRef = useRef<number | null>(null);
  const [shufflingCards, setShufflingCards] = useState<ShufflingCard[]>([]);

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

            const targetSlot = getOpponentHandSlot(
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
              y: targetSlot.y,
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

  // Detects a hand shuffle (either side) by comparing handShuffleVersion
  // across renders, and builds one ShufflingCard per card currently in
  // that hand — each one converges from wherever it's rendered right
  // now to the hand's shared center, then fans back out to its new slot
  // (see AnimatedCard's own viaOverride handling for how that sequence
  // actually plays). Runs after the entries/previousEntries tracking
  // above, since it needs this render's own previousEntries snapshot —
  // the positions each card is animating FROM.
  useEffect(() => {
    const newShufflingCards: ShufflingCard[] = [];

    if (me && previousMeShuffleVersionRef.current !== null) {
      if (me.handShuffleVersion > previousMeShuffleVersionRef.current) {
        const rowY = me.hand.length > 0 ? getHandSlot(me.hand.length, 0).y : 0;
        me.hand.forEach((instance, index) => {
          const fromEntry =
            previousEntries.find((e) => e.instanceId === instance.instanceId) ??
            entries.find((e) => e.instanceId === instance.instanceId);
          if (!fromEntry) return;
          const targetSlot = getHandSlot(me.hand.length, index);
          newShufflingCards.push({
            id: instance.instanceId,
            card: instance.card,
            from: {
              x: fromEntry.x,
              y: fromEntry.y,
              scale: fromEntry.scale,
              rotation: fromEntry.rotation,
              faceDown: fromEntry.faceDown,
            },
            via: { x: HAND_CENTER_X, y: rowY, scale: HAND_CARD_SCALE, rotation: 0, faceDown: false },
            to: {
              x: targetSlot.x,
              y: targetSlot.y,
              scale: targetSlot.width / CARD_NATIVE_WIDTH,
              rotation: 0,
              faceDown: false,
            },
            zIndex: 340 + index,
          });
        });
      }
    }

    if (opponent && previousOpponentShuffleVersionRef.current !== null) {
      if (opponent.handShuffleVersion > previousOpponentShuffleVersionRef.current) {
        // The opponent's hand is rendered as position-only proxies (see
        // cardPositions.ts's own documentation on this) — there's no
        // real card identity to track moving from one slot to another,
        // since the real cards are never sent to this client at all.
        // What CAN still be shown is the shuffle happening: every
        // current proxy slot converges to the center and fans back out
        // to that exact same slot, which is honest about what's
        // actually known (a shuffle occurred) without pretending to
        // show real cards changing places.
        for (let index = 0; index < opponent.handCount; index++) {
          const id = `opponent-hand-${index}`;
          const fromEntry =
            previousEntries.find((e) => e.instanceId === id) ??
            entries.find((e) => e.instanceId === id);
          const targetSlot = getOpponentHandSlot(opponent.handCount, index);
          const from: CardVisualPosition = fromEntry
            ? {
                x: fromEntry.x,
                y: fromEntry.y,
                scale: fromEntry.scale,
                rotation: fromEntry.rotation,
                faceDown: fromEntry.faceDown,
              }
            : {
                x: targetSlot.x,
                y: targetSlot.y,
                scale: targetSlot.width / CARD_NATIVE_WIDTH,
                rotation: 180,
                faceDown: true,
              };
          newShufflingCards.push({
            id,
            card: null,
            from,
            via: {
              x: HAND_CENTER_X,
              y: OPPONENT_HAND_TOP,
              scale: HAND_CARD_SCALE,
              rotation: 180,
              faceDown: true,
            },
            to: {
              x: targetSlot.x,
              y: targetSlot.y,
              scale: targetSlot.width / CARD_NATIVE_WIDTH,
              rotation: 180,
              faceDown: true,
            },
            zIndex: 340 + index,
          });
        }
      }
    }

    if (newShufflingCards.length > 0) {
      const ids = new Set(newShufflingCards.map((c) => c.id));
      setShufflingCards((current) => [
        ...current.filter((c) => !ids.has(c.id)),
        ...newShufflingCards,
      ]);
    }

    previousMeShuffleVersionRef.current = me?.handShuffleVersion ?? null;
    previousOpponentShuffleVersionRef.current = opponent?.handShuffleVersion ?? null;
    // previousEntries/entries are intentionally read above but not
    // listed here — they're already dependencies of the OTHER effect in
    // this component, which always runs first and keeps
    // previousEntriesRef current before this one reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.handShuffleVersion, opponent?.handShuffleVersion]);

  // Cards actively mid-shuffle are rendered via their OWN AnimatedCard
  // instance below (shufflingCards.map) instead of through the normal
  // entries.map pass — this filters them out of that normal pass so
  // there isn't a duplicate, un-animated element sitting underneath the
  // animated one at the same position.
  const shufflingIds = new Set(shufflingCards.map((c) => c.id));
  const opponentHandIds = new Set(
    entries
      .filter((entry) => entry.instanceId.startsWith('opponent-hand-'))
      .map((entry) => entry.instanceId),
  );
  const visibleEntries = entries.filter(
    (entry) => !shufflingIds.has(entry.instanceId) && (!stageOffset || !opponentHandIds.has(entry.instanceId)),
  );
  const opponentHandEntries = stageOffset
    ? entries.filter((entry) => !shufflingIds.has(entry.instanceId) && opponentHandIds.has(entry.instanceId))
    : [];
  const opponentShufflingCards = stageOffset
    ? shufflingCards.filter((card) => card.id.startsWith('opponent-hand-'))
    : [];
  const boardShufflingCards = shufflingCards.filter(
    (card) => !card.id.startsWith('opponent-hand-'),
  );

  const renderReturningCard = (card: ReturningOpponentCard, fixed: boolean) => {
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
        coordinateOffset={fixed ? stageOffset : null}
        animationDuration={0.45}
        onAnimationComplete={() => {
          setReturningCards((current) => current.filter((item) => item.id !== card.id));
        }}
      />
    );
  };

  // Mirrors the main visibleEntries loop's own selectionColor/onClick
  // logic exactly (see that loop below) — factored out since it's now
  // needed in two separate opponentHandLayer render blocks above, not
  // just the one place it used to matter.
  const renderOpponentHandEntry = (entry: CardPositionEntry) => (
    <AnimatedCard
      key={entry.instanceId}
      entry={entry}
      coordinateOffset={stageOffset}
      selectionColor={getSelectionColor(
        entry.instanceId,
        mySelection,
        opponentSelection,
        me,
        myRole,
        opponentRole,
      )}
      onClick={
        entry.instanceId.startsWith('opponent-hand-') && onSelectCard && opponentRole
          ? () => {
              const index = Number(entry.instanceId.slice('opponent-hand-'.length));
              onSelectCard(encodeHandSelection(opponentRole, index));
            }
          : undefined
      }
    />
  );

  const renderShufflingCard = (card: ShufflingCard, fixed: boolean) => {
    const shuffleEntry: CardPositionEntry = {
      instanceId: card.id,
      card: card.card,
      x: card.to.x,
      y: card.to.y,
      rotation: card.to.rotation,
      scale: card.to.scale,
      faceDown: card.to.faceDown,
      zIndex: card.zIndex,
    };

    return (
      <AnimatedCard
        key={`shuffling-${card.id}`}
        entry={shuffleEntry}
        startOverride={card.from}
        viaOverride={card.via}
        coordinateOffset={fixed ? stageOffset : null}
        animationDuration={0.6}
        onAnimationComplete={() => {
          setShufflingCards((current) => current.filter((item) => item.id !== card.id));
        }}
      />
    );
  };

  return (
    <div ref={layerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {visibleEntries.map((entry) => (
        <AnimatedCard
          key={entry.instanceId}
          entry={entry}
          hiddenSource={getHiddenSource(entry, previousOpponent, opponent)}
          selectionColor={getSelectionColor(
            entry.instanceId,
            mySelection,
            opponentSelection,
            me,
            myRole,
            opponentRole,
          )}
          onClick={
            entry.instanceId.startsWith('opponent-hand-') && onSelectCard && opponentRole
              ? () => {
                  const index = Number(entry.instanceId.slice('opponent-hand-'.length));
                  onSelectCard(encodeHandSelection(opponentRole, index));
                }
              : undefined
          }
        />
      ))}

      {returningCards.length > 0 && (
        <>
          {!stageOffset && returningCards.map((card) => renderReturningCard(card, false))}
          {stageOffset && (
            <div className="MultiplayerDuelFieldPage-opponentHandLayer">
              {returningCards.map((card) => renderReturningCard(card, true))}
            </div>
          )}
        </>
      )}

      {boardShufflingCards.map((card) => renderShufflingCard(card, false))}

      {stageOffset && opponentShufflingCards.length > 0 && (
        <div className="MultiplayerDuelFieldPage-opponentHandLayer">
          {opponentHandEntries.map((entry) => renderOpponentHandEntry(entry))}
          {opponentShufflingCards.map((card) => renderShufflingCard(card, true))}
        </div>
      )}

      {stageOffset && opponentShufflingCards.length === 0 && opponentHandEntries.length > 0 && (
        <div className="MultiplayerDuelFieldPage-opponentHandLayer">
          {opponentHandEntries.map((entry) => renderOpponentHandEntry(entry))}
        </div>
      )}
    </div>
  );
}

export default CardLayer;