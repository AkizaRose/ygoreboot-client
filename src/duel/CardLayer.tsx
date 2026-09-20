import { useEffect, useLayoutEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
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
import type { CardInstance, PlacedCard } from '../types/CardInstance';
import type { CardData } from '../types/Card';
import CardImage from '../components/CardView/CardImage';
import cardBackImg from '../assets/card/CardBack.png';
import equipSpellOverlayImg from '../assets/ui//duelfield/equipspelloverlay.png';
import attackOverlayImg from '../assets/ui//duelfield/attackoverlay.png';
import {
  CARD_NATIVE_WIDTH,
  CARD_NATIVE_HEIGHT,
  FIELD_CARD_SCALE,
  HAND_CARD_SCALE,
  BOARD_WIDTH,
  OPPONENT_HAND_TOP,
  getDeckZoneSlot,
  getFieldZoneSlot,
  getHandSlot,
  getOpponentHandSlot,
} from './cardGeometry';

// How far a hand card floats upward while hovered — see the main render
// loop's own hoverEntry. Purely a visual cue for which card the cursor
// is over; ~13% of a hand card's own rendered height (HAND_CELL_HEIGHT,
// cardGeometry.ts) reads as a clear lift without the card overlapping
// its neighbors' own art. Exported so Hand.tsx's own context menu can
// rise by the exact same amount, rather than the two drifting apart if
// this ever changes.
export const HAND_HOVER_LIFT = 28;

// Deck shuffle animation — applied directly to the REAL, already-visible
// pile card backs (see the main render loop's own shuffleOscillation),
// not separate decorative elements. Each affected card oscillates
// purely horizontally: out to one side, back through center to the
// other, repeated DECK_SHUFFLE_CYCLES times, landing exactly back at
// its own real x — see buildDeckShuffleXKeyframes below for how the
// keyframe sequence is generated from these.
const DECK_SHUFFLE_TOTAL_DURATION_S = 0.6;
// One "cycle" = out to the first side and back through to the other and
// back to center (a full sine period) — 3 cycles reads as a rapid
// shuffle without being too busy within ~1 second.
const DECK_SHUFFLE_CYCLES = 3;
// Keyframes sampled per cycle (0, peak, 0, trough, back to 0) — 4 gives
// a clean sine sample without needing an excessive keyframe count.
const DECK_SHUFFLE_SEGMENTS_PER_CYCLE = 4;
// Maximum horizontal deviation, as a fraction of the card's own
// (scaled) width — the user asked for "never look like they are fully
// flying out of the pile", hence comfortably under 100%.
const DECK_SHUFFLE_AMPLITUDE_RATIO = 0.15;
// Staggers each successive pile card's own start slightly, so they
// don't all oscillate in perfect unison — reads more like an actual
// shuffle.
const DECK_SHUFFLE_STAGGER_S = 0.01;
// How long the shuffle stays "active" (affecting which real cards get
// shuffleOscillation at all) before being cleared — must comfortably
// exceed the last card's own finish time (DECK_SHUFFLE_TOTAL_DURATION_S
// + the largest stagger delay, converted to ms), so nothing reverts to
// its normal, static position mid-motion.
const DECK_SHUFFLE_CLEANUP_MS = 500;

// How long the attack overlay's own flight (attacker -> target/hand
// center) plus its fade takes, once an attack has actually resolved
// (see AttackResolutionAnimation below) — separate from the aiming
// phase, which has no fixed duration at all since it lasts as long as
// the player takes to pick a target.
const ATTACK_RESOLUTION_DURATION_S = 0.8;
// Stays visible for the first 65% of the flight (arriving at the
// target), then fades over the remainder — "move... then stopping and
// fading out", not fading gradually the whole way there.
const ATTACK_RESOLUTION_FADE_START = 0.65;
// Must comfortably exceed ATTACK_RESOLUTION_DURATION_S (converted to
// ms) so the animation is never cut off before it finishes.
const ATTACK_RESOLUTION_CLEANUP_MS = 900;
// The raw angle from atan2 treats 0deg as "pointing right" — but
// attackoverlay.png is drawn pointing up, 90deg short of that in CSS's
// own clockwise-positive rotation. Added to every computed angle (both
// the aiming overlay's own live mouse-follow rotation and the resolved
// flight's own constant one) so the image actually points where it's
// aimed/heading, not 90deg off from it.
const ATTACK_OVERLAY_ROTATION_OFFSET_DEG = 90;
// "Slingshot" wind-up before the forward snap (see
// AttackResolutionAnimation's own pullback field) — a small step in the
// OPPOSITE direction of travel first, slower than the snap that
// follows, giving the flight some weight/anticipation rather than
// moving in a straight line at a constant rate the whole way.
// Reached comparatively early despite covering very little distance —
// that's what makes it read as a deliberate, slower wind-up rather than
// a stutter.
const ATTACK_SLINGSHOT_PULLBACK_TIME = 0.25;
// How far to pull back, as a fraction of the full attacker->target
// distance — "move away slightly", so comfortably under the forward
// distance it's about to cover.
const ATTACK_SLINGSHOT_PULLBACK_RATIO = 0.12;

interface ControlTransferRecord {
  id: string;
  toRole: PlayerRole;
  toIndex: number;
  card: PlacedCard;
  // Where this card came from, described so EVERY client can correctly
  // resolve it into their own coordinate space — not raw (x, y, rotation)
  // coordinates, which are only ever valid from the CAPTURING client's
  // own perspective (their own side of the board is always rendered
  // flipped=false, from their own point of view) and get silently
  // misinterpreted by any OTHER client reusing them verbatim, since the
  // exact same numeric coordinates land in a different physical board
  // location depending on who's rendering them. fromRole is whose side
  // this came from; each client computes fromFlipped = fromRole !==
  // myRole themselves and feeds it through the same geometry functions
  // that already compute the destination — see buildControlTransferCard
  // below. 'monster' additionally carries an index (which of the 3
  // slots); Grave/Banished don't need one, since the whole pile occupies
  // one spot that matters for an animation's starting point.
  fromRole: PlayerRole;
  fromZone: { kind: 'monster'; index: number } | { kind: 'grave' } | { kind: 'banished' };
}

interface CardReturnItem {
  destination: 'hand' | 'grave' | 'banished' | 'mainDeckTop' | 'mainDeckBottom' | 'extraDeck';
  card: CardInstance;
  from: CardVisualPosition;
}

interface CardReturnBatch {
  id: string;
  toRole: PlayerRole;
  items: CardReturnItem[];
}

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
  // Raw arrays from the duel doc (see useMultiplayerDuel's own
  // DuelDoc.pendingControlTransfers/pendingCardReturns) — CardLayer
  // watches these for entries it hasn't animated yet, to play a card
  // traveling from its own embedded `from` position (captured by
  // whichever client initiated the action, before anything was
  // actually removed — see DuelDoc's own comment on why this can't
  // just be looked up in previousEntries instead) to its new
  // destination, rather than the card just silently appearing there
  // once the underlying data updates. Defaults to empty, not undefined,
  // so the detection effect below never needs an extra null check.
  //
  // This is the REMOTE path — the same animation can also be triggered
  // LOCALLY and immediately, before this prop ever updates, via the
  // imperative handle (see CardLayerHandle below and the ref this
  // component is wrapped in) — the two share the exact same
  // build-an-InTransitCard logic and the exact same processed-key Sets,
  // so whichever path notices an entry first is the one that actually
  // queues it; the other is a no-op once it catches up.
  pendingControlTransfers?: ControlTransferRecord[];
  pendingCardReturns?: CardReturnBatch[];
  // True while a Ritual Summon's material-selection step is in progress
  // (see the duel page's pendingRitualSummon) — the ONLY reason the
  // player's own hand cards are ever individually clickable here at
  // all. Every other selectable card (Monster/Spell-Trap/Field Zone) is
  // clicked through its own FieldZone instead (see DuelField.tsx),
  // which coexists correctly with hover-menus and other zone
  // interactions — hand cards have no FieldZone underneath them to hook
  // into, so this is the one place a hand-based selection can be wired
  // up at all. Multi-select, same as Fusion's own Monster Zone material
  // selection (see DuelField.tsx's own isSelectingFusionMaterial).
  isSelectingRitualMaterial?: boolean;
  selectedRitualHandIndices?: number[];
  onToggleRitualHandMaterial?: (index: number) => void;
  // Which of the player's OWN hand cards, if any, is in an active hover
  // state — the card itself, or its own context menu, with a brief
  // grace period while moving between them (see Hand.tsx's own
  // hoveredInstanceId, which this mirrors exactly) — drives the
  // hover-lift effect (see the main render loop's own hoverEntry).
  // Provided as a prop, not tracked locally, because the actual hover
  // detection happens in Hand.tsx (a sibling component, rendered
  // separately from this one — see that file's own comment on why its
  // .Hand-cell elements have to sit BELOW this layer, which is exactly
  // why this layer can't detect its own hover directly without
  // blocking that).
  hoveredHandInstanceId?: string | null;
  // Which Monster/Spell-Trap Zone card, on EITHER side, is currently
  // hovered — see DuelField's own onFieldInstanceHoverChange, which is
  // what actually detects this (FieldZone elements, not this layer,
  // sit under the cursor). Drives the Equip Spell hover-overlay
  // specifically (see equipOverlayInstanceId below, and its own
  // comment on why the resolution lives here rather than in the duel
  // page) — nothing else consumes this yet.
  hoveredFieldInstanceId?: string | null;
  // The attacking monster's own zone index while aiming (see
  // MultiplayerDuelFieldPage's own pendingAttack) — null whenever no
  // attack is currently being aimed. Always the ATTACKING PLAYER's own
  // monsterZones index (an attack is only ever aimed from this client's
  // own monster), so this never needs a flipped flag the way
  // cross-player targets elsewhere in this file do.
  pendingAttackIndex?: number | null;
  // Raw viewport mouse coordinates, tracked only while
  // pendingAttackIndex is set — see the aiming overlay's own rotation
  // logic further down for how this gets turned into an angle.
  attackMousePosition?: { x: number; y: number } | null;
  // Card Display preview support for the reveal zone specifically (see
  // the main render loop's own isRevealedCard) — every other card gets
  // this via its own FieldZone or Hand-cell instead (see DuelField.tsx/
  // Hand.tsx), neither of which the reveal zone has, since it isn't
  // part of either player's own field or hand at all. onMouseEnter/
  // onMouseLeave are wired directly on AnimatedCard for this one case
  // only — everywhere else, a card's hover is still handled by
  // whatever's underneath it, not here.
  onCardHover?: (card: CardData) => void;
  onCardHoverEnd?: () => void;
  // Which best-of-three duel is currently in progress (see
  // useMultiplayerDuel's own duelNumber) — the ONLY thing this component
  // uses it for is detecting a hard duel reset (see isDuelReset further
  // down): startNextDuel replaces the opponent's ENTIRE public state
  // (hand, field, grave, banished, deck counts — everything) in one
  // shot, all at once, under brand new instanceIds that share nothing
  // with the previous duel's. Every diffing effect below is built to
  // explain a single card's worth of change between two snapshots (a
  // draw, a shuffle, one card moving to the grave, and so on) — fed a
  // wholesale reset instead, they instead read as dozens of opponent
  // cards simultaneously "disappearing" with the wrong explanation (see
  // isDuelReset's own comment), which is what made the opponent's hand,
  // field and grave all appear empty at the start of duels 2 and 3.
  duelNumber?: number;
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
  // null for a genuinely anonymous slide (see the detection effect's
  // own comment on draw/hand-to-deck) — AnimatedCard already renders
  // entry.card === null as a plain card back with no CardImage at all,
  // the same convention used for the opponent's own hidden hand/deck
  // proxies elsewhere in this file.
  card: CardInstance['card'] | null;
  from: CardVisualPosition;
  to: CardVisualPosition;
  zIndex: number;
  // Same convention as InTransitCard's own field of the same name —
  // true only when the destination is the opponent's hand specifically
  // (the viewport-fixed layer's whole reason to exist). A deck
  // destination (Main or Extra) is an ordinary board-space position,
  // same as any field zone.
  fixed: boolean;
}

// A card traveling between the two players' own areas entirely — either
// changing control (to a Monster Zone on the OTHER player's field) or
// returning to its true owner (Grave, Banished, hand, or either deck —
// see PlacedCard/CardInstance's own `owner` field). Unlike every other
// animation in this file, both endpoints can be on either side of the
// board, in either coordinate space.
interface InTransitCard {
  id: string;
  card: CardInstance['card'];
  from: CardVisualPosition;
  to: CardVisualPosition;
  zIndex: number;
  // True only when the destination is the OPPONENT's hand specifically
  // — the one destination that needs the viewport-fixed
  // opponentHandLayer treatment (see stageOffset's own comment above).
  // Every other destination (a field zone, Grave, Banished, either
  // deck, or the player's OWN hand) stays in normal board-space
  // coordinates.
  fixed: boolean;
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

// Marks a Main Deck as actively shuffling (see the detection effect
// further down) — NOT a separate decorative element the way an earlier
// version of this feature used. While one of these exists for a given
// side, the main render loop applies shuffleOscillation (see
// AnimatedCard's own prop of that name) to whichever REAL entries are
// currently part of that side's visible pile, so the animation plays on
// the actual card backs already there rather than anything spawned
// separately.
interface DeckShuffleAnimation {
  id: string;
  // Which side's deck this plays over — mirrors AnimatedCard's own
  // `flipped` convention (true for the opponent's side).
  flipped: boolean;
}

// Generates the x-offset keyframe sequence for one pile card's own
// shuffle oscillation — a clean sine wave sampled at
// DECK_SHUFFLE_SEGMENTS_PER_CYCLE points per cycle, for
// DECK_SHUFFLE_CYCLES cycles, scaled by amplitude and flipped by
// direction (1 = out to the right first, -1 = left first). Always
// starts AND ends at exactly 0 (sin(0) = sin(2*pi*wholeNumber) = 0), so
// composing this with the card's own real x always lands it back
// exactly where it started — no separate "return" step needed.
function buildDeckShuffleXKeyframes(amplitude: number, direction: 1 | -1): number[] {
  const totalSegments = DECK_SHUFFLE_CYCLES * DECK_SHUFFLE_SEGMENTS_PER_CYCLE;
  return Array.from({ length: totalSegments + 1 }, (_, i) =>
    direction * amplitude * Math.sin((2 * Math.PI * i) / DECK_SHUFFLE_SEGMENTS_PER_CYCLE),
  );
}

// One resolved attack's own flight — see PublicPlayerState's own
// activeAttack for where this originates. rotation is computed ONCE,
// from the actual attacker->target direction (not carried over from
// whatever the aiming phase's own live mouse-follow angle happened to
// be), and stays constant for the whole flight, since the direction
// itself never changes once resolved.
interface AttackResolutionAnimation {
  id: string;
  from: { x: number; y: number; scale: number };
  // The "slingshot" wind-up point, reached first — a small step in the
  // OPPOSITE direction of travel from `from`, before snapping forward
  // to `to`. Only x/y: the card's own size doesn't need to change for
  // this tiny pull-back, so the render function reuses from.scale for
  // it rather than tracking a third scale value.
  pullback: { x: number; y: number };
  to: { x: number; y: number; scale: number };
  rotation: number;
}

// Resolves an activeAttack into its actual from/to positions —
// attackerSide says whose activeAttack this is (whose own monster the
// attack came FROM), so the opposite side is always the defender, which
// is where toIndex (when not null) is looked up. Symmetric by design:
// this client's own attack and the opponent's attack against THIS
// client both go through the exact same resolution logic, just with
// `me`/`opponent` swapped for who counts as attacker vs defender.
function buildAttackResolutionAnimation(
  activeAttack: { id: string; fromIndex: number; toIndex: number | null },
  attackerSide: 'me' | 'opponent',
  me: MyDuelState | null,
  opponent: OpponentDuelState | null,
  entries: CardPositionEntry[],
): AttackResolutionAnimation | null {
  const attacker = attackerSide === 'me' ? me : opponent;
  const defender = attackerSide === 'me' ? opponent : me;
  if (!attacker || !defender) return null;

  const attackerInstanceId = attacker.monsterZones[activeAttack.fromIndex]?.instanceId;
  const fromEntry = attackerInstanceId
    ? entries.find((entry) => entry.instanceId === attackerInstanceId)
    : null;
  if (!fromEntry) return null;

  let to: { x: number; y: number; scale: number };
  if (activeAttack.toIndex !== null) {
    const targetInstanceId = defender.monsterZones[activeAttack.toIndex]?.instanceId;
    const toEntry = targetInstanceId
      ? entries.find((entry) => entry.instanceId === targetInstanceId)
      : null;
    if (!toEntry) return null;
    to = { x: toEntry.x, y: toEntry.y, scale: toEntry.scale };
  } else {
    // Direct attack — flies toward the DEFENDING side's own hand
    // center. Both are fixed board-space reference points (the same
    // ones the hand-shuffle "via" waypoint already uses), not tied to
    // any individual card slot, so no viewport-fixed handling is needed
    // here the way the opponent's real hand proxies elsewhere need.
    to =
      attackerSide === 'me'
        ? { x: HAND_CENTER_X, y: OPPONENT_HAND_TOP, scale: HAND_CARD_SCALE }
        : { x: HAND_CENTER_X, y: getHandSlot(1, 0).y, scale: HAND_CARD_SCALE };
  }

  const fromCenterX = fromEntry.x + (CARD_NATIVE_WIDTH * fromEntry.scale) / 2;
  const fromCenterY = fromEntry.y + (CARD_NATIVE_HEIGHT * fromEntry.scale) / 2;
  const toCenterX = to.x + (CARD_NATIVE_WIDTH * to.scale) / 2;
  const toCenterY = to.y + (CARD_NATIVE_HEIGHT * to.scale) / 2;
  const rotation =
    (Math.atan2(toCenterY - fromCenterY, toCenterX - fromCenterX) * 180) / Math.PI +
    ATTACK_OVERLAY_ROTATION_OFFSET_DEG;

  // A small step in the OPPOSITE direction of travel — extends the
  // from->to line backward past `from` itself, by
  // ATTACK_SLINGSHOT_PULLBACK_RATIO of the full distance. Computed from
  // the raw from/to points (not their centers, which rotation above
  // needed) — pullback only ever feeds into x/y positioning below, so
  // it should stay in that same top-left-corner coordinate space.
  const pullback = {
    x: fromEntry.x - (to.x - fromEntry.x) * ATTACK_SLINGSHOT_PULLBACK_RATIO,
    y: fromEntry.y - (to.y - fromEntry.y) * ATTACK_SLINGSHOT_PULLBACK_RATIO,
  };

  return {
    id: activeAttack.id,
    from: { x: fromEntry.x, y: fromEntry.y, scale: fromEntry.scale },
    pullback,
    to,
    rotation,
  };
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
    containsPlaced(opponent.revealedCard) ||
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
  shuffleOscillation = null,
  onAnimationComplete,
  animationDuration = 0.2,
  coordinateOffset = null,
  selectionColor = null,
  onClick,
  onMouseEnter,
  onMouseLeave,
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
  // Deck shuffle animation (see DeckShuffleAnimation above) — when set,
  // this card's own x oscillates horizontally around its real entry.x
  // for DECK_SHUFFLE_TOTAL_DURATION_S (see buildDeckShuffleXKeyframes),
  // then lands back exactly on entry.x. Every other property (y, width,
  // height, rotate) is untouched and keeps animating toward its normal
  // target as usual — the pile itself never visually reorders during a
  // shuffle, only this horizontal wobble plays over it. index staggers
  // this card's own start slightly later than index 0's (see
  // DECK_SHUFFLE_STAGGER_S); direction picks which side it swings
  // toward first.
  shuffleOscillation?: { index: number; direction: 1 | -1 } | null;
  onAnimationComplete?: () => void;
  animationDuration?: number;
  coordinateOffset?: { x: number; y: number } | null;
  // 'mine' (red) or 'opponent' (blue) — see getSelectionColor. 'material'
  // (gold, matching FieldZone's own .FieldZone--selected outline) is
  // separate from those two: it's for Ritual Summon's own hand-material
  // selection (see the main render loop's own onClick below), a
  // multi-select indicator rather than getSelectionColor's single
  // mine/opponent selection. Purely visual either way; rendered with
  // pointer-events:none regardless of onClick below, so the outline
  // itself never blocks a click reaching whatever it's layered on top
  // of.
  selectionColor?: 'mine' | 'opponent' | 'material' | null;
  // Wired up for two different things, mutually exclusive in practice:
  // the opponent's hand proxies (the "select card" feature — see
  // CardLayer's own render loop), and, during Ritual Summon's own
  // material-selection step, the player's OWN hand cards. Everywhere
  // else, selecting or acting on a card is handled by that card's own
  // FieldZone instead, not here — hand cards (either player's) have no
  // FieldZone underneath them to hook into at all, which is why both
  // cases end up here rather than there.
  onClick?: () => void;
  // Only ever wired up for the reveal zone's own card (see the main
  // render loop's own isRevealedCard) — everywhere else, hover is
  // handled by whatever's underneath the card instead (a FieldZone, or
  // Hand.tsx's own .Hand-cell), which the reveal zone doesn't have.
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
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
  // Deck-shuffle oscillation is computed independently of the
  // via/plain split below — shuffleOscillation only ever applies to a
  // pile card sitting still in place (never mid-via, in practice), so
  // it's folded into the plain branch's own x value rather than
  // needing a third top-level case.
  const oscillationXKeyframes = shuffleOscillation
    ? buildDeckShuffleXKeyframes(
        DECK_SHUFFLE_AMPLITUDE_RATIO * displayWidth,
        shuffleOscillation.direction,
      ).map((offset) => entry.x + offsetX + offset)
    : null;
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
        x: oscillationXKeyframes ?? entry.x + offsetX,
        y: entry.y + offsetY,
        width: displayWidth,
        height: displayHeight,
        rotate: entry.rotation,
      };
  // times is only meaningful alongside an actual keyframe array — for the
  // plain (non-via) case above, framer-motion ignores it entirely, since
  // there's only one value to reach, not a sequence to schedule.
  const keyframeTimes = viaOverride ? [0, 0.4, 0.6, 1] : undefined;
  // x's own transition is entirely independent of animationDuration
  // while oscillating — DECK_SHUFFLE_TOTAL_DURATION_S and a staggered
  // delay instead, with `times` evenly spaced across the sine sample
  // (see buildDeckShuffleXKeyframes). Every other property below is
  // untouched, still using the normal animationDuration.
  const xTransition = shuffleOscillation
    ? {
        duration: DECK_SHUFFLE_TOTAL_DURATION_S,
        delay: shuffleOscillation.index * DECK_SHUFFLE_STAGGER_S,
        ease: 'easeInOut' as const,
        times: Array.from(
          { length: DECK_SHUFFLE_CYCLES * DECK_SHUFFLE_SEGMENTS_PER_CYCLE + 1 },
          (_, i) => i / (DECK_SHUFFLE_CYCLES * DECK_SHUFFLE_SEGMENTS_PER_CYCLE),
        ),
      }
    : { duration: animationDuration, ease: 'easeInOut' as const, times: keyframeTimes };

  return (
    <motion.div
      initial={initialAnimation}
      animate={animateTarget}
      transition={{
        x: xTransition,
        y: { duration: animationDuration, ease: 'easeInOut', times: keyframeTimes },
        width: { duration: animationDuration, ease: 'easeInOut', times: keyframeTimes },
        height: { duration: animationDuration, ease: 'easeInOut', times: keyframeTimes },
        rotate: { duration: animationDuration, ease: 'easeInOut', times: keyframeTimes },
      }}
      onAnimationComplete={onAnimationComplete}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        zIndex: entry.zIndex,
        // Only clickable/hoverable at all when onClick or onMouseEnter
        // was actually passed (opponent hand proxies, the player's own
        // hand cards during Ritual Summon's own material selection, or
        // the reveal zone's own card) — every other card stays
        // pointer-events:none here, same as before this feature
        // existed, so it never blocks hover/click reaching whatever's
        // underneath it: a FieldZone for field cards, or Hand's own
        // .Hand-cell for hand cards (see Hand.tsx's own comment on why
        // it still needs to sit BELOW this layer for exactly this
        // reason — its hover-menu trigger depends on events reaching it
        // unobstructed). The reveal zone has no such underlying element
        // at all, so enabling this for it is safe.
        pointerEvents: onClick || onMouseEnter ? 'auto' : 'none',
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
            boxShadow: `inset 0 0 0 3px ${
              selectionColor === 'mine' ? '#e53935' : selectionColor === 'opponent' ? '#1e88e5' : '#d4af37'
            }`,
            borderRadius: 4,
          }}
        />
      )}
    </motion.div>
  );
}

// Exposed so the initiating client can trigger its OWN animation
// immediately, synchronously, at the moment it starts a control
// transfer or card return — rather than only ever finding out via
// pendingControlTransfers/pendingCardReturns updating, which requires a
// full round trip to Firestore and back. The sending client's own
// local, optimistic state update (applyMeUpdate's own
// requestAnimationFrame) removes the card from its rendered entries
// almost immediately — well before that round trip completes — so
// without this, the sending client's own screen would show the card
// simply vanish, then reappear mid-animation once the remote data
// finally caught up. Both this path and the prop-driven one below share
// the exact same processed-key Sets, so whichever notices an entry
// first is the one that actually queues it — the other is a no-op by
// the time it catches up.
export interface CardLayerHandle {
  queueControlTransfer: (transfer: ControlTransferRecord) => void;
  queueCardReturn: (batch: CardReturnBatch) => void;
}

// The "aiming" overlay for an attack — sits on the attacking monster and
// rotates to continuously point at the mouse (see
// MultiplayerDuelFieldPage's own pendingAttack/attackMousePosition). A
// separate, dedicated component (not AnimatedCard) since this isn't a
// card at all, just a rotating reticle image with no card-flip, no
// entry-to-entry transition, nothing else AnimatedCard's own machinery
// is built for.
//
// The rotation math deliberately avoids ever computing the board's own
// CSS scale factor: rather than converting board-space coordinates into
// viewport pixels (which would need that scale factor), this measures
// its OWN rendered position directly via getBoundingClientRect() once,
// right after mounting — at that point the browser has already done
// all the scaling/positioning math, so the measured center is already
// in the exact same viewport-pixel space attackMousePosition (from a
// raw mousemove event) is in. The board's own position never changes
// while aiming is active, so measuring once and caching is enough —
// no need to re-measure on every mouse move (which would force a
// layout reflow each time).
function AttackAimOverlay({
  entry,
  mousePosition,
}: {
  entry: CardPositionEntry;
  mousePosition: { x: number; y: number } | null;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const centerRef = useRef<{ x: number; y: number } | null>(null);
  const [rotation, setRotation] = useState(0);

  useLayoutEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    centerRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.instanceId]);

  useEffect(() => {
    if (!mousePosition || !centerRef.current) return;
    const dx = mousePosition.x - centerRef.current.x;
    const dy = mousePosition.y - centerRef.current.y;
    setRotation((Math.atan2(dy, dx) * 180) / Math.PI + ATTACK_OVERLAY_ROTATION_OFFSET_DEG);
  }, [mousePosition]);

  const displayWidth = CARD_NATIVE_WIDTH * entry.scale;
  const displayHeight = CARD_NATIVE_HEIGHT * entry.scale;

  return (
    <div
      ref={overlayRef}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: displayWidth,
        height: displayHeight,
        transform: `translate(${entry.x}px, ${entry.y}px)`,
        zIndex: 490,
        pointerEvents: 'none',
      }}
    >
      <img
        src={attackOverlayImg}
        alt=""
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          transform: `rotate(${rotation}deg)`,
          transformOrigin: 'center center',
        }}
      />
    </div>
  );
}

const CardLayer = forwardRef<CardLayerHandle, CardLayerProps>(function CardLayer(
  {
    entries,
    me = null,
    opponent = null,
    myRole = null,
    mySelection = null,
    opponentSelection = null,
    onSelectCard,
    pendingControlTransfers = [],
    pendingCardReturns = [],
    isSelectingRitualMaterial = false,
    selectedRitualHandIndices = [],
    onToggleRitualHandMaterial,
    hoveredHandInstanceId = null,
    hoveredFieldInstanceId = null,
    pendingAttackIndex = null,
    attackMousePosition = null,
    onCardHover,
    onCardHoverEnd,
    duelNumber,
  },
  ref,
) {
  const opponentRole: PlayerRole | null =
    myRole === 'player1' ? 'player2' : myRole === 'player2' ? 'player1' : null;
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [stageOffset, setStageOffset] = useState<{ x: number; y: number } | null>(null);
  const previousOpponentRef = useRef<OpponentDuelState | null>(null);
  const previousEntriesRef = useRef<CardPositionEntry[]>([]);
  const [returningCards, setReturningCards] = useState<ReturningOpponentCard[]>([]);
  // Simple incrementing counter for the two genuinely-anonymous-slide
  // cases below (a draw, or a card returning from hand to the Main
  // Deck) — neither has a real instanceId to key off at all, unlike
  // every other entry in returningCards.
  const anonymousSlideIdRef = useRef(0);

  // A hard duel reset (duelNumber just changed) is treated exactly like
  // this component's very first mount: previousOpponent/previousEntries
  // read as null/empty for THIS render, so every diffing effect below
  // takes its own "nothing to compare against yet" branch instead of
  // reading the previous duel's entire board as a pile of cards that
  // mysteriously vanished. previousDuelNumberRef is deliberately read
  // and written right here during render (not inside an effect): the
  // ref has to already reflect the NEW duelNumber by the time
  // previousOpponent/previousEntries are computed below, in this exact
  // render — updating it inside a useEffect/useLayoutEffect would only
  // take hold from the NEXT render onward, one render too late to stop
  // this one from misreading the reset.
  const previousDuelNumberRef = useRef(duelNumber);
  const isDuelReset = duelNumber !== previousDuelNumberRef.current;
  previousDuelNumberRef.current = duelNumber;
  const previousOpponent = isDuelReset ? null : previousOpponentRef.current;
  const previousEntries = isDuelReset ? [] : previousEntriesRef.current;

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
  // Same "only detect an actual increment" reasoning as the hand-shuffle
  // refs above, for mainDeckShuffleVersion instead — see
  // DeckShuffleAnimation's own comment above.
  const previousMeMainDeckShuffleVersionRef = useRef<number | null>(null);
  const previousOpponentMainDeckShuffleVersionRef = useRef<number | null>(null);
  const [deckShuffleAnimations, setDeckShuffleAnimations] = useState<DeckShuffleAnimation[]>([]);
  // Same "only detect an actual change" reasoning as the shuffle
  // version refs above, keyed on activeAttack's own id instead of a
  // version counter — a fresh crypto.randomUUID() per attack already
  // serves the same purpose.
  const previousMeActiveAttackIdRef = useRef<string | null>(null);
  const previousOpponentActiveAttackIdRef = useRef<string | null>(null);
  const [attackResolutionAnimations, setAttackResolutionAnimations] = useState<
    AttackResolutionAnimation[]
  >([]);
  const [inTransitCards, setInTransitCards] = useState<InTransitCard[]>([]);

  // Clears out any leftover in-flight animation from the duel that just
  // ended (e.g. an attack or a card transfer that was still resolving
  // the instant the duel's outcome was decided) so nothing from it lingers
  // as a stray ghost card once the fresh duel's own state arrives. The
  // version/attack-id refs those animations are keyed off also get reset
  // here, rather than waiting for their own detection effects to notice —
  // those compare against the FRESH duel's starting values on the very
  // next run regardless, but resetting them explicitly means a value
  // that happens to coincide with where duel 1 left off can never be
  // mistaken for "no change" and skipped.
  useEffect(() => {
    if (!isDuelReset) return;
    setReturningCards([]);
    setInTransitCards([]);
    setShufflingCards([]);
    setDeckShuffleAnimations([]);
    setAttackResolutionAnimations([]);
    previousMeShuffleVersionRef.current = me?.handShuffleVersion ?? null;
    previousOpponentShuffleVersionRef.current = opponent?.handShuffleVersion ?? null;
    previousMeMainDeckShuffleVersionRef.current = me?.mainDeckShuffleVersion ?? null;
    previousOpponentMainDeckShuffleVersionRef.current = opponent?.mainDeckShuffleVersion ?? null;
    previousMeActiveAttackIdRef.current = me?.activeAttack?.id ?? null;
    previousOpponentActiveAttackIdRef.current = opponent?.activeAttack?.id ?? null;
  }, [isDuelReset, me, opponent]);

  useEffect(() => {
    if (previousOpponent && opponent) {
      const handGrew = opponent.handCount > previousOpponent.handCount;
      const handShrank = opponent.handCount < previousOpponent.handCount;
      const mainDeckGrew = opponent.mainDeckCount > previousOpponent.mainDeckCount;
      const mainDeckShrank = opponent.mainDeckCount < previousOpponent.mainDeckCount;
      const extraDeckGrew = opponent.extraDeckCount > previousOpponent.extraDeckCount;

      if (handGrew || mainDeckGrew || extraDeckGrew) {
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
          // A KNOWN card left a known public position (grave, banished,
          // field, or the reveal zone) — whichever pile actually grew
          // is where it's headed. Only one of these three is ever
          // expected to grow at once for the actions that reach this
          // branch, so checking them in a fixed order (rather than
          // trying to handle more than one growing at once) is enough.
          const handCount = opponent.handCount;
          const firstNewHandIndex = previousOpponent.handCount;
          const newReturningCards = disappeared
            .map((id, offset) => {
              const fromEntry = previousEntries.find((entry) => entry.instanceId === id);
              if (!fromEntry) return null;

              const from: CardVisualPosition = {
                x: fromEntry.x,
                y: fromEntry.y,
                scale: fromEntry.scale,
                rotation: fromEntry.rotation,
                faceDown: fromEntry.faceDown,
              };

              let to: CardVisualPosition;
              // 320 by default (matches every other returning-card
              // destination) — except landing at the BOTTOM of the Main
              // Deck, which needs to render BEHIND the whole pile
              // instead of in front of it (see
              // PublicPlayerState's own lastMainDeckReturnSide for the
              // full reasoning). 10 is comfortably below deckPileEntries'
              // own baseZIndex of 50 in cardPositions.ts, so it's
              // guaranteed to sit underneath every card in the pile,
              // not just the topmost one.
              let toZIndex = 320;
              if (handGrew) {
                const targetSlot = getOpponentHandSlot(
                  handCount,
                  Math.min(handCount - 1, firstNewHandIndex + offset),
                );
                to = {
                  x: targetSlot.x,
                  y: targetSlot.y,
                  scale: targetSlot.width / CARD_NATIVE_WIDTH,
                  rotation: 180,
                  faceDown: true,
                };
              } else {
                // mainDeckGrew or extraDeckGrew — a single, shared pile
                // position (not indexed by offset the way hand slots
                // are), since every card in the opponent's own deck
                // renders at the same spot regardless of how many are
                // in it.
                const slot = getDeckZoneSlot(true, mainDeckGrew ? 'main' : 'extra');
                to = {
                  x: slot.x,
                  y: slot.y,
                  scale: FIELD_CARD_SCALE,
                  rotation: 180,
                  faceDown: true,
                };
                if (mainDeckGrew && opponent.lastMainDeckReturnSide === 'bottom') {
                  toZIndex = 10;
                }
              }

              return {
                id,
                card: fromEntry.card,
                from,
                to,
                zIndex: toZIndex + offset,
                fixed: handGrew,
              };
            })
            .filter((card): card is ReturningOpponentCard => card !== null);

          if (newReturningCards.length > 0) {
            setReturningCards((current) => [...current, ...newReturningCards]);
          }
        } else if (handGrew && mainDeckShrank) {
          // A draw — the opponent's own hand grew and their own Main
          // Deck shrank by the same event, but no KNOWN card explains
          // it (that's the branch above, for grave/banished/field/the
          // reveal zone specifically). The only remaining source is the
          // deck's own anonymous top card — never individually visible
          // to this client at all, unlike every other case this effect
          // handles, so this animates a plain card back (card: null)
          // rather than a real one, from the deck's own shared position
          // to the new hand slot.
          const targetSlot = getOpponentHandSlot(opponent.handCount, opponent.handCount - 1);
          const deckSlot = getDeckZoneSlot(true, 'main');
          setReturningCards((current) => [
            ...current,
            {
              id: `anon-draw-${anonymousSlideIdRef.current++}`,
              card: null,
              from: { x: deckSlot.x, y: deckSlot.y, scale: FIELD_CARD_SCALE, rotation: 180, faceDown: true },
              to: {
                x: targetSlot.x,
                y: targetSlot.y,
                scale: targetSlot.width / CARD_NATIVE_WIDTH,
                rotation: 180,
                faceDown: true,
              },
              zIndex: 320,
              fixed: true,
            },
          ]);
        } else if (mainDeckGrew && handShrank) {
          // The reverse of a draw — an anonymous hand card (never
          // individually visible to this client either) joining the
          // also-anonymous Main Deck. Approximates the FROM position as
          // the last slot the previous, larger hand had — the exact
          // card that left isn't knowable, but this is close enough to
          // read as "came from the hand," the same approximation
          // tolerance used elsewhere in this file for similar cases.
          const fromSlot = getOpponentHandSlot(previousOpponent.handCount, previousOpponent.handCount - 1);
          const deckSlot = getDeckZoneSlot(true, 'main');
          setReturningCards((current) => [
            ...current,
            {
              id: `anon-todeck-${anonymousSlideIdRef.current++}`,
              card: null,
              from: {
                x: fromSlot.x,
                y: fromSlot.y,
                scale: fromSlot.width / CARD_NATIVE_WIDTH,
                rotation: 180,
                faceDown: true,
              },
              to: { x: deckSlot.x, y: deckSlot.y, scale: FIELD_CARD_SCALE, rotation: 180, faceDown: true },
              // Same top/bottom distinction as the known-card branch
              // above — see PublicPlayerState's own
              // lastMainDeckReturnSide.
              zIndex: opponent.lastMainDeckReturnSide === 'bottom' ? 10 : 320,
              fixed: false,
            },
          ]);
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

  // Detects a Main Deck shuffle (either side) by comparing
  // mainDeckShuffleVersion across renders, same idea as the
  // handShuffleVersion detection above but far simpler: this doesn't
  // need to track any real card's from/to position at all — the cards
  // this plays on never leave the pile or change position, they just
  // temporarily oscillate around wherever they already are (see
  // DeckShuffleAnimation's own comment above and shuffleOscillation's
  // own comment on AnimatedCard) — just that a shuffle happened and
  // which side's deck it was.
  useEffect(() => {
    const newAnimations: DeckShuffleAnimation[] = [];

    if (me && previousMeMainDeckShuffleVersionRef.current !== null) {
      if (me.mainDeckShuffleVersion > previousMeMainDeckShuffleVersionRef.current) {
        newAnimations.push({ id: `deck-shuffle-me-${me.mainDeckShuffleVersion}`, flipped: false });
      }
    }
    if (opponent && previousOpponentMainDeckShuffleVersionRef.current !== null) {
      if (opponent.mainDeckShuffleVersion > previousOpponentMainDeckShuffleVersionRef.current) {
        newAnimations.push({
          id: `deck-shuffle-opponent-${opponent.mainDeckShuffleVersion}`,
          flipped: true,
        });
      }
    }

    if (newAnimations.length > 0) {
      setDeckShuffleAnimations((current) => [...current, ...newAnimations]);
      // Clears itself once the animation has definitely finished —
      // DECK_SHUFFLE_CLEANUP_MS is comfortably longer than the last
      // pile card's own finish time, so no card ever reverts to its
      // normal, static x mid-oscillation.
      window.setTimeout(() => {
        const ids = new Set(newAnimations.map((a) => a.id));
        setDeckShuffleAnimations((current) => current.filter((a) => !ids.has(a.id)));
      }, DECK_SHUFFLE_CLEANUP_MS);
    }

    previousMeMainDeckShuffleVersionRef.current = me?.mainDeckShuffleVersion ?? null;
    previousOpponentMainDeckShuffleVersionRef.current = opponent?.mainDeckShuffleVersion ?? null;
  }, [me?.mainDeckShuffleVersion, opponent?.mainDeckShuffleVersion]);

  // Detects an attack actually resolving (either side) by comparing
  // activeAttack's own id across renders — see
  // AttackResolutionAnimation's own comment above for the full
  // reasoning, and buildAttackResolutionAnimation for how the from/to
  // positions and rotation are actually worked out.
  useEffect(() => {
    const newAnimations: AttackResolutionAnimation[] = [];

    if (me?.activeAttack && me.activeAttack.id !== previousMeActiveAttackIdRef.current) {
      const animation = buildAttackResolutionAnimation(me.activeAttack, 'me', me, opponent, entries);
      if (animation) newAnimations.push(animation);
    }
    if (
      opponent?.activeAttack &&
      opponent.activeAttack.id !== previousOpponentActiveAttackIdRef.current
    ) {
      const animation = buildAttackResolutionAnimation(
        opponent.activeAttack,
        'opponent',
        me,
        opponent,
        entries,
      );
      if (animation) newAnimations.push(animation);
    }

    if (newAnimations.length > 0) {
      setAttackResolutionAnimations((current) => [...current, ...newAnimations]);
      // Clears itself once the flight and fade have definitely
      // finished — ATTACK_RESOLUTION_CLEANUP_MS comfortably exceeds
      // ATTACK_RESOLUTION_DURATION_S, so nothing is ever cut off
      // mid-flight.
      window.setTimeout(() => {
        const ids = new Set(newAnimations.map((a) => a.id));
        setAttackResolutionAnimations((current) => current.filter((a) => !ids.has(a.id)));
      }, ATTACK_RESOLUTION_CLEANUP_MS);
    }

    previousMeActiveAttackIdRef.current = me?.activeAttack?.id ?? null;
    previousOpponentActiveAttackIdRef.current = opponent?.activeAttack?.id ?? null;
    // entries is read above but intentionally not a dependency —
    // unlike previousEntries elsewhere in this file, entries is a
    // plain value recomputed fresh on every render, not a ref that
    // needs another effect to keep it current first. Listing it here
    // would re-run this effect on every render (entries always
    // "changes"), when it should only run when activeAttack itself
    // actually changes; the id comparison inside already guards
    // against detecting the same attack twice regardless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.activeAttack, opponent?.activeAttack]);

  // Cards changing control (moving to the OTHER player's Monster Zone)
  // or returning to their true owner (Grave, Banished, hand, either
  // deck) — see DuelDoc's own comments on pendingControlTransfers/
  // pendingCardReturns for the data side of this. Tracked with their
  // own Sets (not a single ref) since, like the shuffle/returning-card
  // detection above, several can genuinely be in flight — or waiting to
  // be noticed — at once. A given entry is only ever queued for
  // animation once; MultiplayerDuelFieldPage's own processed-refs
  // govern the DATA side of idempotency (actually moving the card) —
  // this is purely about not queuing the same visual twice, whichever
  // of the two paths below (prop-driven effect, or the imperative
  // handle) notices it first.
  const processedControlTransfersRef = useRef<Set<string>>(new Set());
  const processedCardReturnsRef = useRef<Set<string>>(new Set());

  const controlTransferKey = (transfer: ControlTransferRecord) => transfer.id;
  const cardReturnItemKey = (batch: CardReturnBatch, item: CardReturnItem) =>
    `${batch.id}:${item.destination}:${item.card.instanceId}`;

  // Shared by both ends of a control transfer (see buildControlTransferCard
  // below) — a Monster Zone slot's exact rendered position AND rotation,
  // Defense Position included. Matches monsterZoneEntries' own formula in
  // cardPositions.ts exactly: dropping the Defense Position term (or the
  // small 0.5px correction) here would silently misrender any Defense
  // Position monster passing through either end of a transfer.
  const monsterZonePosition = (flipped: boolean, index: number, isDefense: boolean) => {
    const slot = getFieldZoneSlot(flipped, 'monster', index);
    const rotation = (isDefense ? -90 : 0) + (flipped ? 180 : 0);
    const position = isDefense ? { x: slot.x + 0.5, y: slot.y + 0.5 } : { x: slot.x, y: slot.y };
    return { x: position.x, y: position.y, rotation };
  };

  const buildControlTransferCard = (transfer: ControlTransferRecord): InTransitCard => {
    const flipped = transfer.toRole !== myRole;
    const isDefense = transfer.card.position === 'defense';
    const dest = monsterZonePosition(flipped, transfer.toIndex, isDefense);

    // Resolved from fromRole/fromZone via pure geometry, not the
    // embedded raw coordinate this used to carry — see
    // ControlTransferRecord's own comment for why. Correct for EVERY
    // client, including the one that initiated the transfer, since
    // nothing here depends on any live/rendered state that could go
    // stale.
    const fromFlipped = transfer.fromRole !== myRole;
    let from: CardVisualPosition;
    if (transfer.fromZone.kind === 'monster') {
      const origin = monsterZonePosition(fromFlipped, transfer.fromZone.index, isDefense);
      from = {
        x: origin.x,
        y: origin.y,
        scale: FIELD_CARD_SCALE,
        rotation: origin.rotation,
        // A control transfer never flips the card — whatever it was
        // (face-up/down) on the sender's field, it arrives the same way.
        faceDown: transfer.card.faceDown,
      };
    } else {
      const originSlot = getFieldZoneSlot(fromFlipped, transfer.fromZone.kind);
      from = {
        x: originSlot.x,
        y: originSlot.y,
        scale: FIELD_CARD_SCALE,
        rotation: fromFlipped ? 180 : 0,
        // Grave and Banished are always shown face-up, regardless of
        // whose they are — see pileEntries' own convention in
        // cardPositions.ts.
        faceDown: false,
      };
    }

    return {
      id: `transfer-${transfer.card.instanceId}`,
      card: transfer.card.card,
      from,
      to: {
        x: dest.x,
        y: dest.y,
        scale: FIELD_CARD_SCALE,
        rotation: dest.rotation,
        faceDown: transfer.card.faceDown,
      },
      zIndex: 360,
      fixed: false,
    };
  };

  const buildCardReturnCard = (batch: CardReturnBatch, item: CardReturnItem): InTransitCard => {
    const flipped = batch.toRole !== myRole;
    let to: CardVisualPosition;
    let fixed = false;

    switch (item.destination) {
      case 'hand': {
        // Only an approximation of where the card will actually land
        // (the real slot depends on the hand's exact contents once
        // it's actually arrived, which this client may not have yet)
        // — deliberately so: the hand-shuffle animation that fires the
        // moment the card actually joins the hand (see
        // MultiplayerDuelFieldPage's own auto-shuffle-on-add) settles
        // every card into its real, final slot immediately after, so
        // this only needs to get the card traveling in roughly the
        // right direction, not land pixel-perfect.
        if (flipped) {
          const approxCount = (opponent?.handCount ?? 0) + 1;
          const slot = getOpponentHandSlot(approxCount, approxCount - 1);
          to = {
            x: slot.x,
            y: slot.y,
            scale: slot.width / CARD_NATIVE_WIDTH,
            rotation: 180,
            faceDown: true,
          };
          fixed = true;
        } else {
          const approxCount = (me?.hand.length ?? 0) + 1;
          const slot = getHandSlot(approxCount, approxCount - 1);
          to = {
            x: slot.x,
            y: slot.y,
            scale: slot.width / CARD_NATIVE_WIDTH,
            rotation: 0,
            faceDown: false,
          };
        }
        break;
      }
      case 'grave':
      case 'banished': {
        const slot = getFieldZoneSlot(flipped, item.destination);
        to = {
          x: slot.x,
          y: slot.y,
          scale: FIELD_CARD_SCALE,
          rotation: flipped ? 180 : 0,
          // Grave and Banished are always shown face-up, regardless of
          // whose they are — see pileEntries' own convention in
          // cardPositions.ts.
          faceDown: false,
        };
        break;
      }
      case 'mainDeckTop':
      case 'mainDeckBottom': {
        const slot = getDeckZoneSlot(flipped, 'main');
        to = {
          x: slot.x,
          y: slot.y,
          scale: FIELD_CARD_SCALE,
          rotation: flipped ? 180 : 0,
          faceDown: true,
        };
        break;
      }
      case 'extraDeck': {
        const slot = getDeckZoneSlot(flipped, 'extra');
        to = {
          x: slot.x,
          y: slot.y,
          scale: FIELD_CARD_SCALE,
          rotation: flipped ? 180 : 0,
          faceDown: true,
        };
        break;
      }
    }

    return {
      id: `return-${item.card.instanceId}`,
      card: item.card.card,
      // Embedded directly in the return record itself, same reasoning
      // as buildControlTransferCard's own `from` above.
      from: item.from,
      to,
      zIndex: 360,
      fixed,
    };
  };

  // The LOCAL, immediate path — called directly by the initiating
  // client at the moment it starts a transfer/return, before
  // pendingControlTransfers/pendingCardReturns has had any chance to
  // update. Shares the exact same processed-key Sets as the prop-driven
  // effect below, so if the remote data catches up and the effect tries
  // to queue the same entry again, it's already marked processed and
  // becomes a no-op.
  useImperativeHandle(
    ref,
    () => ({
      queueControlTransfer: (transfer) => {
        const key = controlTransferKey(transfer);
        if (processedControlTransfersRef.current.has(key)) return;
        processedControlTransfersRef.current.add(key);
        setInTransitCards((current) => [...current, buildControlTransferCard(transfer)]);
      },
      queueCardReturn: (batch) => {
        const newCards = batch.items
          .filter((item) => !processedCardReturnsRef.current.has(cardReturnItemKey(batch, item)))
          .map((item) => {
            processedCardReturnsRef.current.add(cardReturnItemKey(batch, item));
            return buildCardReturnCard(batch, item);
          });
        if (newCards.length > 0) {
          setInTransitCards((current) => [...current, ...newCards]);
        }
      },
    }),
    [myRole, me, opponent],
  );

  // The REMOTE, prop-driven path — for whichever client DIDN'T initiate
  // the action (the local path above is what covers the initiator
  // itself), and as a fallback for the initiator too, in case its own
  // imperative call above somehow didn't fire.
  useEffect(() => {
    if (!myRole || !opponentRole) return;
    const newCards: InTransitCard[] = [];

    for (const transfer of pendingControlTransfers) {
      const key = controlTransferKey(transfer);
      if (processedControlTransfersRef.current.has(key)) continue;
      processedControlTransfersRef.current.add(key);
      newCards.push(buildControlTransferCard(transfer));
    }

    for (const batch of pendingCardReturns) {
      for (const item of batch.items) {
        const key = cardReturnItemKey(batch, item);
        if (processedCardReturnsRef.current.has(key)) continue;
        processedCardReturnsRef.current.add(key);
        newCards.push(buildCardReturnCard(batch, item));
      }
    }

    if (newCards.length > 0) {
      setInTransitCards((current) => [...current, ...newCards]);
    }
    // previousEntries is read above but intentionally not listed — same
    // reasoning as the shuffle-detection effect just above: the OTHER
    // effect in this component always runs first each render and keeps
    // previousEntriesRef current before this one reads it. me/opponent
    // are read only for an approximate hand count, not worth
    // re-triggering this whole effect over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingControlTransfers, pendingCardReturns, myRole, opponentRole]);

  // Cards actively mid-shuffle are rendered via their OWN AnimatedCard
  // instance below (shufflingCards.map) instead of through the normal
  // entries.map pass — this filters them out of that normal pass so
  // there isn't a duplicate, un-animated element sitting underneath the
  // animated one at the same position.
  const shufflingIds = new Set(shufflingCards.map((c) => c.id));
  // Strips the "transfer-"/"return-" prefix to get back the real
  // instanceId each in-transit card corresponds to — needed so the
  // normal render pass can exclude it. Once the card actually arrives
  // in its destination's real state (monsterZones/hand/grave/etc.), it
  // starts appearing in `entries` too; without this, both the real
  // entry and the still-animating in-transit card would render at once.
  const inTransitIds = new Set(
    inTransitCards.map((c) => c.id.replace(/^(transfer|return)-/, '')),
  );
  // Same "exclude the un-animated real entry while a separate, animated
  // stand-in is playing" reasoning as shufflingIds/inTransitIds above —
  // opponent.handCount has ALREADY increased by the time a return is
  // detected (that increase is what triggers it), so the normal
  // opponent-hand-N proxy entries already include a slot for each card
  // currently returning TO HAND. Without this, that slot's own proxy
  // would render instantly, with no animation at all, while
  // returningCards separately animates a duplicate element toward the
  // very same destination — a "ghost" card sitting there before the
  // real, animated one even arrives. New proxy slots are always
  // appended at the END (matching handCount), so the cards currently
  // returning are always the LAST N of them.
  //
  // Filtered to card.fixed (true only for a hand destination — see
  // ReturningOpponentCard's own comment) before counting, deliberately
  // — returningCards can also contain cards headed to a deck instead
  // (see the detection effect above), which have no hand slot of their
  // own to exclude at all. Counting the whole array regardless of
  // destination would wrongly exclude a real, unrelated hand slot for
  // every deck-destined card mixed in, hiding a card that was never
  // actually leaving the hand in the first place.
  // Resolves which OTHER card (if any) should show the Equip Spell
  // hover-overlay right now, given whichever field card is currently
  // hovered (see DuelField's own onFieldInstanceHoverChange). Lives
  // here rather than in the duel page because it only needs props this
  // component already receives (me/opponent), and the result is
  // consumed immediately below for positioning — no need to split it
  // across two files. Two directions, since either side could be the
  // one actually hovered — both are a single, direct instanceId
  // comparison, since equippedTo is the target MONSTER's own instanceId
  // (see PlacedCard's own comment on why), not a (role, index) pair
  // that would need figuring out which player's zones to search first:
  //   1. Hovering an Equip Spell itself — find it in either player's
  //      spellTrapZones; its own equippedTo IS the result directly.
  //   2. Hovering a monster — find an Equip Spell (in either player's
  //      spellTrapZones) whose own equippedTo equals the hovered
  //      instanceId; ITS instanceId is the result.
  let equipOverlayInstanceId: string | null = null;
  if (hoveredFieldInstanceId && me && opponent) {
    const allSpells = [...me.spellTrapZones, ...opponent.spellTrapZones];
    const hoveredSpell = allSpells.find((zone) => zone?.instanceId === hoveredFieldInstanceId);
    if (hoveredSpell?.equippedTo) {
      equipOverlayInstanceId = hoveredSpell.equippedTo;
    } else {
      const equipSpell = allSpells.find((zone) => zone?.equippedTo === hoveredFieldInstanceId);
      equipOverlayInstanceId = equipSpell?.instanceId ?? null;
    }
  }

  const returningOpponentHandIds = new Set(
    opponent
      ? returningCards
          .filter((card) => card.fixed)
          .map((_, i) => `opponent-hand-${opponent.handCount - 1 - i}`)
      : [],
  );
  const opponentHandIds = new Set(
    entries
      .filter((entry) => entry.instanceId.startsWith('opponent-hand-'))
      .map((entry) => entry.instanceId),
  );
  const visibleEntries = entries.filter(
    (entry) =>
      !shufflingIds.has(entry.instanceId) &&
      !inTransitIds.has(entry.instanceId) &&
      !returningOpponentHandIds.has(entry.instanceId) &&
      (!stageOffset || !opponentHandIds.has(entry.instanceId)),
  );
  const opponentHandEntries = stageOffset
    ? entries.filter(
        (entry) =>
          !shufflingIds.has(entry.instanceId) &&
          !returningOpponentHandIds.has(entry.instanceId) &&
          opponentHandIds.has(entry.instanceId),
      )
    : [];
  const opponentShufflingCards = stageOffset
    ? shufflingCards.filter((card) => card.id.startsWith('opponent-hand-'))
    : [];
  const boardShufflingCards = shufflingCards.filter(
    (card) => !card.id.startsWith('opponent-hand-'),
  );

  const renderInTransitCard = (card: InTransitCard) => {
    const inTransitEntry: CardPositionEntry = {
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
        key={card.id}
        entry={inTransitEntry}
        startOverride={card.from}
        coordinateOffset={card.fixed ? stageOffset : null}
        animationDuration={0.5}
        onAnimationComplete={() => {
          setInTransitCards((current) => current.filter((item) => item.id !== card.id));
        }}
      />
    );
  };

  // Cards leaving a KNOWN public position (see containsOpponentInstance)
  // and reappearing in the opponent's hand — always rendered face-down
  // here regardless of how they looked at their own origin, since a
  // hand (either player's — this covers both the reveal zone returning
  // to its own owner's hand and any other public-to-hand departure) is
  // never visible once a card actually lands in it from this client's
  // own point of view.
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

  // An attack's own resolved flight — see AttackResolutionAnimation's
  // own comment above. Same outer-translates/inner-rotates split as
  // AttackAimOverlay: the outer motion.div animates x/y/width/height/
  // opacity via framer-motion's own keyframes, while the inner <img>
  // holds a constant, plain CSS rotation (the direction never changes
  // mid-flight, so it doesn't need to be animated at all).
  const renderAttackResolutionAnimation = (animation: AttackResolutionAnimation) => (
    <motion.div
      key={animation.id}
      initial={{
        x: animation.from.x,
        y: animation.from.y,
        width: CARD_NATIVE_WIDTH * animation.from.scale,
        height: CARD_NATIVE_HEIGHT * animation.from.scale,
        opacity: 1,
      }}
      animate={{
        // 4 keyframes now, not 3 — from -> pullback (the "slingshot"
        // wind-up) -> to -> to (holding for the fade). Every property
        // shares this same shape deliberately: a mismatched keyframe
        // count is what caused the fade-during-flight bug fixed
        // earlier, since framer-motion spreads a shorter property
        // evenly across the FULL duration regardless of `times`.
        x: [animation.from.x, animation.pullback.x, animation.to.x, animation.to.x],
        y: [animation.from.y, animation.pullback.y, animation.to.y, animation.to.y],
        width: [
          CARD_NATIVE_WIDTH * animation.from.scale,
          CARD_NATIVE_WIDTH * animation.from.scale,
          CARD_NATIVE_WIDTH * animation.to.scale,
          CARD_NATIVE_WIDTH * animation.to.scale,
        ],
        height: [
          CARD_NATIVE_HEIGHT * animation.from.scale,
          CARD_NATIVE_HEIGHT * animation.from.scale,
          CARD_NATIVE_HEIGHT * animation.to.scale,
          CARD_NATIVE_HEIGHT * animation.to.scale,
        ],
        // Stays fully visible through both the wind-up and the snap,
        // fading only over the final stretch once it's actually
        // arrived — see ATTACK_RESOLUTION_FADE_START.
        opacity: [1, 1, 1, 0],
      }}
      transition={{
        duration: ATTACK_RESOLUTION_DURATION_S,
        times: [0, ATTACK_SLINGSHOT_PULLBACK_TIME, ATTACK_RESOLUTION_FADE_START, 1],
        // One easing per segment (3 segments for 4 keyframes): the
        // wind-up decelerates INTO the pulled-back point (a deliberate,
        // slowing pull), the snap accelerates OUT of it toward the
        // target (building speed as it releases — the actual
        // "slingshot" feel), and the final hold segment doesn't move at
        // all, so its own easing is irrelevant.
        ease: ['easeOut', 'easeIn', 'linear'],
      }}
      style={{ position: 'absolute', left: 0, top: 0, zIndex: 490, pointerEvents: 'none' }}
    >
      <img
        src={attackOverlayImg}
        alt=""
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          transform: `rotate(${animation.rotation}deg)`,
          transformOrigin: 'center center',
        }}
      />
    </motion.div>
  );

  // True while EITHER side's Main Deck is currently shuffling (see
  // DeckShuffleAnimation above) — checked once per render rather than
  // per-entry, since every visible pile card on a given side shares the
  // same answer.
  const isMeMainDeckShuffling = deckShuffleAnimations.some((a) => !a.flipped);
  const isOpponentMainDeckShuffling = deckShuffleAnimations.some((a) => a.flipped);

  return (
    <div ref={layerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {visibleEntries.map((entry) => {
        // Computed unconditionally now, not just during Ritual
        // selection — also needed for the hover-lift effect below,
        // which applies regardless of mode. isSelectableHandCard keeps
        // the ORIGINAL gating for Ritual-specific behavior (selection
        // outline, toggling), same as before.
        const myHandIndex = me?.hand.findIndex((c) => c.instanceId === entry.instanceId) ?? -1;
        const isMyHandCard = myHandIndex !== -1;
        const isSelectableHandCard = isSelectingRitualMaterial && isMyHandCard;
        const isHovered = isMyHandCard && hoveredHandInstanceId === entry.instanceId;
        // True for whichever side's card currently sits in the reveal
        // zone (see PublicPlayerState's own revealedCard) — the one
        // case where hover is detected directly on this layer, since
        // there's no FieldZone or Hand-cell underneath a reveal-zone
        // card the way there is for every other card.
        const isRevealedCard =
          entry.instanceId === me?.revealedCard?.instanceId ||
          entry.instanceId === opponent?.revealedCard?.instanceId;
        // Purely a rendered-position tweak — reuses AnimatedCard's own
        // existing x/y animation entirely (see its own animate prop)
        // rather than introducing a separate motion value: hovering
        // just feeds it a different target y for the SAME transition it
        // already has, so "smoothly float up, smoothly settle back
        // down" comes for free, with no new animation machinery needed.
        const hoverEntry = isHovered ? { ...entry, y: entry.y - HAND_HOVER_LIFT } : entry;
        // See DeckShuffleAnimation/AnimatedCard's own shuffleOscillation
        // comments — pileIndex comes from wherever this entry's own
        // position within the pile is already known: me.mainDeck's own
        // array index for a real card, or the index already encoded in
        // an opponent-mainDeck-N proxy id. Even indices swing right
        // first, odd indices swing left first, so roughly half go each
        // way.
        let shuffleOscillation: { index: number; direction: 1 | -1 } | null = null;
        if (isMeMainDeckShuffling && me) {
          const pileIndex = me.mainDeck.findIndex((c) => c.instanceId === entry.instanceId);
          if (pileIndex !== -1) {
            shuffleOscillation = { index: pileIndex, direction: pileIndex % 2 === 0 ? 1 : -1 };
          }
        } else if (isOpponentMainDeckShuffling && entry.instanceId.startsWith('opponent-mainDeck-')) {
          const pileIndex = Number(entry.instanceId.slice('opponent-mainDeck-'.length));
          shuffleOscillation = { index: pileIndex, direction: pileIndex % 2 === 0 ? 1 : -1 };
        }
        return (
          <AnimatedCard
            key={entry.instanceId}
            entry={hoverEntry}
            hiddenSource={getHiddenSource(entry, previousOpponent, opponent)}
            shuffleOscillation={shuffleOscillation}
            selectionColor={
              isSelectableHandCard
                ? selectedRitualHandIndices.includes(myHandIndex)
                  ? 'material'
                  : null
                : getSelectionColor(entry.instanceId, mySelection, opponentSelection, me, myRole, opponentRole)
            }
            onClick={
              isSelectableHandCard && onToggleRitualHandMaterial
                ? () => onToggleRitualHandMaterial(myHandIndex)
                : entry.instanceId.startsWith('opponent-hand-') && onSelectCard && opponentRole
                  ? () => {
                      const index = Number(entry.instanceId.slice('opponent-hand-'.length));
                      onSelectCard(encodeHandSelection(opponentRole, index));
                    }
                  : undefined
            }
            onMouseEnter={
              isRevealedCard && onCardHover && entry.card
                ? () => onCardHover(entry.card!)
                : undefined
            }
            onMouseLeave={isRevealedCard && onCardHoverEnd ? onCardHoverEnd : undefined}
          />
        );
      })}

      {returningCards.filter((card) => !card.fixed).map((card) => renderReturningCard(card, false))}

      {stageOffset && returningCards.some((card) => card.fixed) && (
        <div className="MultiplayerDuelFieldPage-opponentHandLayer">
          {returningCards.filter((card) => card.fixed).map((card) => renderReturningCard(card, true))}
        </div>
      )}

      {inTransitCards.filter((card) => !card.fixed).map((card) => renderInTransitCard(card))}

      {stageOffset && inTransitCards.some((card) => card.fixed) && (
        <div className="MultiplayerDuelFieldPage-opponentHandLayer">
          {inTransitCards.filter((card) => card.fixed).map((card) => renderInTransitCard(card))}
        </div>
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

      {/* The Equip Spell hover-overlay (see equipOverlayInstanceId's own
          comment above for how the target is resolved). Always
          board-space: both a Monster Zone card and a Spell/Trap Zone
          card are ordinary field positions, never part of the
          viewport-fixed opponentHandLayer above, so this needs none of
          that layer's own stageOffset handling. Purely visual — no
          onClick/onMouseEnter, so pointerEvents stays off and it never
          blocks whatever's underneath it (the real FieldZone hover
          target this whole feature depends on). */}
      {equipOverlayInstanceId &&
        (() => {
          const overlayEntry = entries.find(
            (entry) => entry.instanceId === equipOverlayInstanceId,
          );
          if (!overlayEntry) return null;
          return (
            <motion.div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: CARD_NATIVE_WIDTH * overlayEntry.scale,
                height: CARD_NATIVE_HEIGHT * overlayEntry.scale,
                transform: `translate(${overlayEntry.x}px, ${overlayEntry.y}px) rotate(${overlayEntry.rotation}deg)`,
                zIndex: 500,
                pointerEvents: 'none',
              }}
              // Oscillates 0% -> 50% -> 0%, continuously, for as long as
              // this stays mounted (i.e. for as long as the hover it
              // depends on lasts) — framer-motion's own animate/
              // transition, not a CSS @keyframes class, since this file
              // has no stylesheet of its own at all and is already
              // built on framer-motion throughout. Only opacity is
              // animated here; the static transform string above
              // (translate + rotate) is a plain, un-animated style
              // value, which framer-motion leaves alone since it isn't
              // one of ITS OWN animatable props (x/y/rotate/scale) —
              // the two coexist without conflict.
              animate={{ opacity: [0, 0.25, 0] }}
              transition={{ duration: 1.25, repeat: Infinity, ease: 'easeInOut' }}
            >
              <img
                src={equipSpellOverlayImg}
                alt=""
                style={{ width: '100%', height: '100%', display: 'block' }}
              />
            </motion.div>
          );
        })()}

      {pendingAttackIndex !== null &&
        (() => {
          const attackerInstanceId = me?.monsterZones[pendingAttackIndex]?.instanceId;
          const attackerEntry = attackerInstanceId
            ? entries.find((entry) => entry.instanceId === attackerInstanceId)
            : null;
          if (!attackerEntry) return null;
          return <AttackAimOverlay entry={attackerEntry} mousePosition={attackMousePosition} />;
        })()}

      {attackResolutionAnimations.map((animation) => renderAttackResolutionAnimation(animation))}
    </div>
  );
});

export default CardLayer;