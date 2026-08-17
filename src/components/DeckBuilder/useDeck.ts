import { useCallback, useState } from 'react';
import type { CardData } from '../../types/Card';
import type { DeckName, DragPayload } from '../../dragState';

export const MAIN_DECK_SIZE = 50;
export const EXTRA_DECK_SIZE = 10;
export const SIDE_DECK_SIZE = 10;
export const MAX_COPIES = 3;
export const MAX_LEGEND_COPIES = 1;
export const MAX_LEGEND_CARDS = 5;

// Fusion, Ritual, and Evolution Monsters go to the Extra Deck; everything
// else (Normal/Effect Monsters, Spells, Traps) goes to the Main Deck. The
// Side Deck ignores this entirely — any card class is allowed there.
function isExtraDeckCard(card: CardData): boolean {
  return (
    card.cardClass === 'Monster' &&
    ['Fusion', 'Ritual', 'Evolution'].includes(card.cardSubclass ?? '')
  );
}

// Sorting classification — deliberately separate from isExtraDeckCard,
// since sorting needs to distinguish Normal vs Effect Monsters too, which
// deck placement doesn't care about.
export type SortCategory =
  | 'NormalMonster'
  | 'EffectMonster'
  | 'Spell'
  | 'Trap'
  | 'Fusion'
  | 'Ritual'
  | 'Evolution'
  | 'Other';

export function getSortCategory(card: CardData): SortCategory {
  if (card.cardClass === 'Monster') {
    switch (card.cardSubclass) {
      case 'Normal':
        return 'NormalMonster';
      case 'Effect':
        return 'EffectMonster';
      case 'Fusion':
        return 'Fusion';
      case 'Ritual':
        return 'Ritual';
      case 'Evolution':
        return 'Evolution';
      default:
        return 'Other';
    }
  }
  if (card.cardClass === 'Spell') return 'Spell';
  if (card.cardClass === 'Trap') return 'Trap';
  return 'Other';
}

// Used by DeckBuilder for the per-category count badges (Normal/Effect/
// Spell/Trap on Main, Fusion/Ritual/Evolution on Extra).
export function countCardsByCategory(cards: CardData[]): Record<SortCategory, number> {
  const counts: Record<SortCategory, number> = {
    NormalMonster: 0,
    EffectMonster: 0,
    Spell: 0,
    Trap: 0,
    Fusion: 0,
    Ritual: 0,
    Evolution: 0,
    Other: 0,
  };
  for (const card of cards) {
    counts[getSortCategory(card)] += 1;
  }
  return counts;
}

const MAIN_DECK_CATEGORY_ORDER: SortCategory[] = ['NormalMonster', 'EffectMonster', 'Spell', 'Trap'];
const EXTRA_DECK_CATEGORY_ORDER: SortCategory[] = ['Fusion', 'Ritual', 'Evolution'];
const SIDE_DECK_CATEGORY_ORDER: SortCategory[] = [
  'NormalMonster',
  'EffectMonster',
  'Spell',
  'Trap',
  'Fusion',
  'Ritual',
  'Evolution',
];

// Sorts by category rank first (per the order lists above), then
// alphabetically by name within each category. Any card whose category
// isn't in the given order list (shouldn't normally happen, given how
// addCard/addCardToSide route cards) sorts after everything else rather
// than throwing or being silently dropped.
function sortByCategoryThenName(cards: CardData[], categoryOrder: SortCategory[]): CardData[] {
  return [...cards].sort((a, b) => {
    const rankA = categoryOrder.indexOf(getSortCategory(a));
    const rankB = categoryOrder.indexOf(getSortCategory(b));
    const safeRankA = rankA === -1 ? categoryOrder.length : rankA;
    const safeRankB = rankB === -1 ? categoryOrder.length : rankB;
    if (safeRankA !== safeRankB) return safeRankA - safeRankB;
    return a.name.localeCompare(b.name);
  });
}

interface DeckState {
  main: CardData[];
  extra: CardData[];
  side: CardData[];
}

const DECK_SIZE: Record<DeckName, number> = {
  main: MAIN_DECK_SIZE,
  extra: EXTRA_DECK_SIZE,
  side: SIDE_DECK_SIZE,
};

// Same Main/Extra/Side type restrictions enforced everywhere else in the
// deck builder (addCard's routing, moveSideCardToMainOrExtra) — applied
// here too so drag-and-drop can't create a deck state that no other
// interaction path would allow (e.g. a Fusion Monster dropped into Main).
function isCardAllowedInDeck(card: CardData, deckName: DeckName): boolean {
  if (deckName === 'side') return true;
  if (deckName === 'extra') return isExtraDeckCard(card);
  return !isExtraDeckCard(card);
}

const EMPTY_DECK: DeckState = { main: [], extra: [], side: [] };

// Shared validation for adding a NEW copy of `card` anywhere in the deck:
// checked against Main + Extra + Side combined, since the copy-count and
// Legend limits apply across the whole deck, not per sub-deck. Used by
// both addCard (Main/Extra) and addCardToSide — NOT used for moves, since
// relocating an already-legal card between decks doesn't change how many
// total copies exist.
function canAddCard(state: DeckState, card: CardData): boolean {
  const combined = [...state.main, ...state.extra, ...state.side];
  const isLegend = !!card.legend;

  const copiesOfThisCard = combined.filter((c) => c.id === card.id).length;
  const maxCopiesForThisCard = isLegend ? MAX_LEGEND_COPIES : MAX_COPIES;
  if (copiesOfThisCard >= maxCopiesForThisCard) {
    console.log(
      `[useDeck] "${card.name}" already at its ${maxCopiesForThisCard}-copy limit — not added.`,
    );
    return false;
  }

  if (isLegend) {
    const legendCount = combined.filter((c) => !!c.legend).length;
    if (legendCount >= MAX_LEGEND_CARDS) {
      console.log(
        `[useDeck] Deck already has ${MAX_LEGEND_CARDS} Legend cards — "${card.name}" not added.`,
      );
      return false;
    }
  }

  return true;
}

export function useDeck() {
  const [deck, setDeck] = useState<DeckState>(EMPTY_DECK);

  // Adds a copy to the Main or Extra Deck (whichever the card belongs in),
  // subject to the combined-deck copy/Legend limits.
  const addCard = useCallback((card: CardData) => {
    setDeck((prev) => {
      if (!canAddCard(prev, card)) return prev;

      if (isExtraDeckCard(card)) {
        if (prev.extra.length >= EXTRA_DECK_SIZE) return prev;
        return { ...prev, extra: [...prev.extra, card] };
      }

      if (prev.main.length >= MAIN_DECK_SIZE) return prev;
      return { ...prev, main: [...prev.main, card] };
    });
  }, []);

  // Adds a copy directly to the Side Deck (Shift+Click from the Card
  // Browser) — any card class is allowed here, no Main/Extra routing.
  const addCardToSide = useCallback((card: CardData) => {
    setDeck((prev) => {
      if (!canAddCard(prev, card)) return prev;
      if (prev.side.length >= SIDE_DECK_SIZE) return prev;
      return { ...prev, side: [...prev.side, card] };
    });
  }, []);

  // Plain-click removal: takes a card out of the deck entirely.
  const removeMainCardAt = useCallback((index: number) => {
    setDeck((prev) => ({ ...prev, main: prev.main.filter((_, i) => i !== index) }));
  }, []);

  const removeExtraCardAt = useCallback((index: number) => {
    setDeck((prev) => ({ ...prev, extra: prev.extra.filter((_, i) => i !== index) }));
  }, []);

  const removeSideCardAt = useCallback((index: number) => {
    setDeck((prev) => ({ ...prev, side: prev.side.filter((_, i) => i !== index) }));
  }, []);

  // Shift+Click moves: relocate a card between decks. These only need a
  // destination-capacity check — the copy/Legend limits were already
  // satisfied when the card was first added, and moving it elsewhere
  // doesn't change the deck's overall composition.
  const moveMainCardToSide = useCallback((index: number) => {
    setDeck((prev) => {
      if (prev.side.length >= SIDE_DECK_SIZE) return prev;
      const card = prev.main[index];
      if (!card) return prev;
      return {
        ...prev,
        main: prev.main.filter((_, i) => i !== index),
        side: [...prev.side, card],
      };
    });
  }, []);

  const moveExtraCardToSide = useCallback((index: number) => {
    setDeck((prev) => {
      if (prev.side.length >= SIDE_DECK_SIZE) return prev;
      const card = prev.extra[index];
      if (!card) return prev;
      return {
        ...prev,
        extra: prev.extra.filter((_, i) => i !== index),
        side: [...prev.side, card],
      };
    });
  }, []);

  // Moving a Side Deck card back routes it to Main or Extra based on its
  // own type, same as a fresh addCard would.
  const moveSideCardToMainOrExtra = useCallback((index: number) => {
    setDeck((prev) => {
      const card = prev.side[index];
      if (!card) return prev;

      if (isExtraDeckCard(card)) {
        if (prev.extra.length >= EXTRA_DECK_SIZE) return prev;
        return {
          ...prev,
          side: prev.side.filter((_, i) => i !== index),
          extra: [...prev.extra, card],
        };
      }

      if (prev.main.length >= MAIN_DECK_SIZE) return prev;
      return {
        ...prev,
        side: prev.side.filter((_, i) => i !== index),
        main: [...prev.main, card],
      };
    });
  }, []);

  // Ctrl+Click: adds another copy of the clicked card, inserted right
  // after it in the same deck section it was clicked in (not routed by
  // type — it's already correctly placed, so the duplicate just joins it).
  // Subject to the same combined-deck copy/Legend limits as any other add.
  const duplicateMainCardAt = useCallback((index: number) => {
    setDeck((prev) => {
      const card = prev.main[index];
      if (!card) return prev;
      if (prev.main.length >= MAIN_DECK_SIZE) return prev;
      if (!canAddCard(prev, card)) return prev;
      const next = [...prev.main];
      next.splice(index + 1, 0, card);
      return { ...prev, main: next };
    });
  }, []);

  const duplicateExtraCardAt = useCallback((index: number) => {
    setDeck((prev) => {
      const card = prev.extra[index];
      if (!card) return prev;
      if (prev.extra.length >= EXTRA_DECK_SIZE) return prev;
      if (!canAddCard(prev, card)) return prev;
      const next = [...prev.extra];
      next.splice(index + 1, 0, card);
      return { ...prev, extra: next };
    });
  }, []);

  const duplicateSideCardAt = useCallback((index: number) => {
    setDeck((prev) => {
      const card = prev.side[index];
      if (!card) return prev;
      if (prev.side.length >= SIDE_DECK_SIZE) return prev;
      if (!canAddCard(prev, card)) return prev;
      const next = [...prev.side];
      next.splice(index + 1, 0, card);
      return { ...prev, side: next };
    });
  }, []);

  // Unified drag-and-drop handler for every scenario:
  //   - New card dragged in from the Card Browser (payload.source === 'browser')
  //   - A deck card dragged to a new position within the SAME deck (reorder)
  //   - A deck card dragged to a DIFFERENT deck (cross-deck move)
  //
  // targetIndex is either a real slot index (dropped on a card — that
  // card, and everything after it, shifts right by one to make room) or
  // null (dropped on empty space — snaps to the first available slot,
  // i.e. appended to the end of a deck array that's always kept compact).
  const dropCardOnDeck = useCallback(
    (payload: DragPayload, targetDeck: DeckName, targetIndex: number | null) => {
      setDeck((prev) => {
        const { card, source, index: sourceIndex } = payload;

        if (!isCardAllowedInDeck(card, targetDeck)) {
          console.log(`[useDeck] "${card.name}" can't be placed in the ${targetDeck} deck.`);
          return prev;
        }

        // New card from the Card Browser: subject to the same copy/Legend
        // limits as any other fresh addition.
        if (source === 'browser') {
          if (!canAddCard(prev, card)) return prev;
          const targetArr = prev[targetDeck];
          if (targetArr.length >= DECK_SIZE[targetDeck]) return prev;
          const next = [...targetArr];
          if (targetIndex === null) {
            next.push(card);
          } else {
            next.splice(targetIndex, 0, card);
          }
          return { ...prev, [targetDeck]: next };
        }

        // Moving an existing deck card — total deck composition doesn't
        // change, so only capacity (for cross-deck moves) matters, not
        // the copy/Legend limits again.
        const sourceDeck = source;
        const sourceArr = prev[sourceDeck];
        if (sourceIndex == null || !sourceArr[sourceIndex]) return prev;

        if (sourceDeck === targetDeck) {
          // Reordering within the same deck: remove first, then insert —
          // if the target index was after the removed slot, it shifts
          // down by one in the now-shorter array, so adjust for that to
          // land the moved card in front of the same visual card it was
          // dropped on.
          const next = [...sourceArr];
          const [moved] = next.splice(sourceIndex, 1);
          if (targetIndex === null) {
            next.push(moved);
          } else {
            const adjustedIndex = targetIndex > sourceIndex ? targetIndex - 1 : targetIndex;
            next.splice(adjustedIndex, 0, moved);
          }
          return { ...prev, [sourceDeck]: next };
        }

        // Cross-deck move: independent arrays, no index adjustment needed.
        const targetArr = prev[targetDeck];
        if (targetArr.length >= DECK_SIZE[targetDeck]) return prev;
        const newSourceArr = sourceArr.filter((_, i) => i !== sourceIndex);
        const newTargetArr = [...targetArr];
        if (targetIndex === null) {
          newTargetArr.push(card);
        } else {
          newTargetArr.splice(targetIndex, 0, card);
        }
        return { ...prev, [sourceDeck]: newSourceArr, [targetDeck]: newTargetArr };
      });
    },
    [],
  );

  const sortAllDecks = useCallback(() => {
    setDeck((prev) => ({
      main: sortByCategoryThenName(prev.main, MAIN_DECK_CATEGORY_ORDER),
      extra: sortByCategoryThenName(prev.extra, EXTRA_DECK_CATEGORY_ORDER),
      side: sortByCategoryThenName(prev.side, SIDE_DECK_CATEGORY_ORDER),
    }));
  }, []);

  const clearAllDecks = useCallback(() => {
    setDeck({ main: [], extra: [], side: [] });
  }, []);

  // Wholesale replacement of the live deck — used by the Deck Manager's
  // Load action. Deliberately does NOT re-run canAddCard/copy-limit
  // validation: a deck that was valid when saved is trusted to still be
  // valid on load (the only thing that could invalidate it is the card
  // database itself changing between save and load, which is an edge case
  // this keeps simple rather than handling).
  const loadDeckState = useCallback((main: CardData[], extra: CardData[], side: CardData[]) => {
    setDeck({ main, extra, side });
  }, []);

  return {
    mainDeck: deck.main,
    extraDeck: deck.extra,
    sideDeck: deck.side,
    addCard,
    addCardToSide,
    removeMainCardAt,
    removeExtraCardAt,
    removeSideCardAt,
    moveMainCardToSide,
    moveExtraCardToSide,
    moveSideCardToMainOrExtra,
    duplicateMainCardAt,
    duplicateExtraCardAt,
    duplicateSideCardAt,
    dropCardOnDeck,
    loadDeckState,
    sortAllDecks,
    clearAllDecks,
  };
}
