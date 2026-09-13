import type { MyDuelState, OpponentDuelState } from '../components/Matchmaking/useMultiplayerDuel';
import type { CardInstance, PlacedCard } from '../types/CardInstance';
import type { CardData } from '../types/Card';
import {
  getFieldZoneSlot,
  getDeckZoneSlot,
  getHandSlot,
  PLAYER_STACK_OFFSETS,
  OPPONENT_STACK_OFFSETS,
  FIELD_CARD_SCALE,
  HAND_CARD_SCALE,
} from './cardGeometry';

// The single output type CardLayer (the one component that replaces
// FieldZone/Hand's own card rendering) consumes — one entry per DOM
// element that will ever exist for a card. `card: null` means "known to
// exist, identity not known to this client" (the opponent's hidden hand/
// deck — see buildOpponentHiddenEntries below); CardLayer renders those
// as a plain card back with no CardImage at all, same as today, just
// arrived at through this one shared code path instead of a special
// case in FieldZone's own "image" branch.
export interface CardPositionEntry {
  instanceId: string;
  card: CardData | null;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  faceDown: boolean;
  zIndex: number;
}

function stackEntries(
  cards: CardInstance[],
  slot: { x: number; y: number },
  offsets: { stepX: number; stepY: number; maxLayers: number },
  rotation: number,
  faceDown: boolean,
  scale: number,
  baseZIndex: number,
): CardPositionEntry[] {
  const visible = cards.slice(-Math.min(cards.length, offsets.maxLayers + 1));
  return visible.map((entry, i) => ({
    instanceId: entry.instanceId,
    card: entry.card,
    x: slot.x + i * offsets.stepX,
    y: slot.y + i * offsets.stepY,
    rotation,
    scale,
    faceDown,
    zIndex: baseZIndex + i,
  }));
}

function monsterZoneEntries(
  zones: (PlacedCard | null)[],
  flipped: boolean,
  zIndexBase: number,
): CardPositionEntry[] {
  const out: CardPositionEntry[] = [];
  zones.forEach((placed, index) => {
    if (!placed) return;
    const slot = getFieldZoneSlot(flipped, 'monster', index);
    const isDefense = placed.position === 'defense';
    const rotation = (isDefense ? -90 : 0) + (flipped ? 180 : 0);
    // A small, deliberate manual correction — Defense Position monsters
    // render 1px off on both axes otherwise, on both sides. Only applied
    // when actually in Defense Position; Attack Position is unaffected.
    const defenseCorrectedSlot = isDefense ? { x: slot.x + 0.5, y: slot.y + 0.5 } : slot;
    const stackCards: CardInstance[] = placed.stackedBelow
      ? [...placed.stackedBelow, { instanceId: placed.instanceId, card: placed.card }]
      : [{ instanceId: placed.instanceId, card: placed.card }];
    out.push(
      ...stackEntries(
        stackCards,
        defenseCorrectedSlot,
        (flipped ? OPPONENT_STACK_OFFSETS : PLAYER_STACK_OFFSETS).monster,
        rotation,
        placed.faceDown,
        FIELD_CARD_SCALE,
        zIndexBase + index * 10,
      ),
    );
  });
  return out;
}

function pileEntries(
  cards: CardInstance[],
  flipped: boolean,
  kind: 'grave' | 'banished',
  zIndexBase: number,
): CardPositionEntry[] {
  if (cards.length === 0) return [];
  const slot = getFieldZoneSlot(flipped, kind);
  return stackEntries(
    cards,
    slot,
    (flipped ? OPPONENT_STACK_OFFSETS : PLAYER_STACK_OFFSETS)[kind],
    flipped ? 180 : 0,
    false,
    FIELD_CARD_SCALE,
    zIndexBase,
  );
}

function spellTrapEntries(
  zones: (PlacedCard | null)[],
  flipped: boolean,
  zIndexBase: number,
): CardPositionEntry[] {
  const out: CardPositionEntry[] = [];
  zones.forEach((placed, index) => {
    if (!placed) return;
    // Spell/Trap Zones live in the deck row (DECK_ZONES), not the field
    // row (FIELD_ZONES) — see DuelField.tsx's own two arrays.
    const slot = getDeckZoneSlot(flipped, 'spellTrap', index);
    out.push({
      instanceId: placed.instanceId,
      card: placed.card,
      x: slot.x,
      y: slot.y,
      rotation: flipped ? 180 : 0,
      scale: FIELD_CARD_SCALE,
      faceDown: placed.faceDown,
      zIndex: zIndexBase + index,
    });
  });
  return out;
}

function fieldZoneEntry(
  placed: PlacedCard | null,
  flipped: boolean,
  zIndex: number,
): CardPositionEntry[] {
  if (!placed) return [];
  const slot = getFieldZoneSlot(flipped, 'field');
  return [
    {
      instanceId: placed.instanceId,
      card: placed.card,
      x: slot.x,
      y: slot.y,
      rotation: flipped ? 180 : 0,
      scale: FIELD_CARD_SCALE,
      faceDown: placed.faceDown,
      zIndex,
    },
  ];
}

// The player's own deck piles: every card gets a REAL, individually
// tracked position now, not just a count + generic image — this is the
// actual new capability this whole refactor is for. Ordered so the
// LAST entry in the array sits at the visual top of the pile (matches
// the existing Grave/Banished/stack convention already used
// throughout), which is also the card a draw would take from.
function deckPileEntries(
  cards: CardInstance[],
  kind: 'mainDeck' | 'extraDeck',
  flipped: boolean,
  zIndexBase: number,
): CardPositionEntry[] {
  if (cards.length === 0) return [];
  const slot = getDeckZoneSlot(flipped, kind === 'mainDeck' ? 'main' : 'extra');
  return stackEntries(
    cards,
    slot,
    (flipped ? OPPONENT_STACK_OFFSETS : PLAYER_STACK_OFFSETS)[kind],
    flipped ? 180 : 0,
    true,
    FIELD_CARD_SCALE,
    zIndexBase,
  );
}

function handEntries(hand: CardInstance[], zIndexBase: number): CardPositionEntry[] {
  return hand.map((entry, index) => {
    const slot = getHandSlot(hand.length, index);
    return {
      instanceId: entry.instanceId,
      card: entry.card,
      x: slot.x,
      y: slot.y,
      rotation: 0,
      scale: HAND_CARD_SCALE,
      faceDown: false,
      zIndex: zIndexBase + index,
    };
  });
}

// The opponent's deck piles: unlike their hand (below), these DO have
// real, known geometry — getDeckZoneSlot(true, ...) is exactly the same
// zone lookup used for every other opponent-side zone, since a face-down
// pile's on-screen position doesn't depend on knowing what's actually in
// it. Only the identity of each individual card is unknown, same
// distinction cardPositions.ts draws everywhere else — hence card: null
// and stable-by-position ids here, same idea as the hand proxies, just
// with real coordinates instead of placeholders.
function opponentDeckPileEntries(
  count: number,
  kind: 'mainDeck' | 'extraDeck',
  zIndexBase: number,
): CardPositionEntry[] {
  if (count === 0) return [];
  const slot = getDeckZoneSlot(true, kind === 'mainDeck' ? 'main' : 'extra');
  const offsets = OPPONENT_STACK_OFFSETS[kind];
  const visibleLayers = Math.min(count, offsets.maxLayers + 1);
  return Array.from({ length: visibleLayers }, (_, i) => ({
    instanceId: `opponent-${kind}-${i}`,
    card: null,
    x: slot.x + i * offsets.stepX,
    y: slot.y + i * offsets.stepY,
    rotation: 180,
    scale: FIELD_CARD_SCALE,
    faceDown: true,
    zIndex: zIndexBase + i,
  }));
}

// The genuinely unsolved piece, made concrete rather than hand-waved:
// the opponent's real HAND contents are deliberately never sent to this
// client at all (see useMultiplayerDuel's PrivatePlayerState) — so there
// is no real instanceId to key these elements by, AND no established
// geometry for where the opponent's hand actually sits on screen yet
// (see this function's own callers). What CAN be known is how many
// cards are there (handCount), which is enough to render the right
// number of card backs — just not in the right positions yet, nor to
// track any specific one of them as "the same card" across a reveal.
//
// These ids are stable by POSITION within the hidden hand, not by card
// identity — "opponent-hand-2" always means "whatever's third from the
// left in the opponent's hand right now," which will happily animate
// smoothly for reordering-free changes (a new card arriving at the end,
// one leaving from a known position) but CANNOT correctly animate "this
// exact hidden card became this exact revealed card" — that transition
// necessarily looks like the proxy disappearing and a new, real entry
// appearing in its place. Solving that fully means the opponent's client
// would need to reveal WHICH position a departing card came from
// alongside the reveal itself, which duels/{duelId}'s public state
// doesn't carry today. Worth treating as a deliberate, documented gap
// for this pass rather than something to paper over.
function buildOpponentHiddenEntries(
  count: number,
  prefix: string,
  slotForIndex: (index: number, count: number) => { x: number; y: number },
  rotation: number,
  scale: number,
  zIndexBase: number,
): CardPositionEntry[] {
  return Array.from({ length: count }, (_, index) => {
    const slot = slotForIndex(index, count);
    return {
      instanceId: `${prefix}-${index}`,
      card: null,
      x: slot.x,
      y: slot.y,
      rotation,
      scale,
      faceDown: true,
      zIndex: zIndexBase + index,
    };
  });
}

export function computeCardPositions(
  me: MyDuelState,
  opponent: OpponentDuelState | null,
): CardPositionEntry[] {
  const entries: CardPositionEntry[] = [
    ...handEntries(me.hand, 100),
    ...deckPileEntries(me.mainDeck, 'mainDeck', false, 50),
    ...deckPileEntries(me.extraDeck, 'extraDeck', false, 50),
    ...monsterZoneEntries(me.monsterZones, false, 200),
    ...spellTrapEntries(me.spellTrapZones, false, 200),
    ...fieldZoneEntry(me.fieldZone, false, 250),
    ...pileEntries(me.grave, false, 'grave', 260),
    ...pileEntries(me.banished, false, 'banished', 270),
  ];

  if (opponent) {
    entries.push(
      ...monsterZoneEntries(opponent.monsterZones, true, 200),
      ...spellTrapEntries(opponent.spellTrapZones, true, 200),
      ...fieldZoneEntry(opponent.fieldZone, true, 250),
      ...pileEntries(opponent.grave, true, 'grave', 260),
      ...pileEntries(opponent.banished, true, 'banished', 270),
      ...opponentDeckPileEntries(opponent.mainDeckCount, 'mainDeck', 50),
      ...opponentDeckPileEntries(opponent.extraDeckCount, 'extraDeck', 50),
      // The hand — see buildOpponentHiddenEntries' own documentation for
      // what this can and can't correctly animate. Slot function here is
      // a placeholder (a simple fanned row) rather than exact geometry,
      // since MultiplayerDuelFieldPage's actual opponent hand positioning
      // (built separately from DuelField's own zone grid) needs its own
      // real coordinates threaded in here — noted rather than guessed
      // at.
      ...buildOpponentHiddenEntries(
        opponent.handCount,
        'opponent-hand',
        (i) => ({ x: i * 30, y: -150 }),
        180,
        HAND_CARD_SCALE,
        100,
      ),
    );
  }

  return entries;
}